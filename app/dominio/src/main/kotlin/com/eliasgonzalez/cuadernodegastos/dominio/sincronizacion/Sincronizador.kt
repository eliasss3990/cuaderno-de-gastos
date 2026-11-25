// El motor de sincronización del celular, sin red: registrar una operación propia (aplicarla y encolarla), armar el lote
// que se sube, confirmar o poner en cuarentena según responde el servidor, aplicar lo que se baja, reintentar y descartar.
// Todo pasa en transacciones del almacén local; la red y los reintentos los maneja quien lo llama.
package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Instante
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.CierreDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.MotorOperaciones
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Razon
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ResultadoValidacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Validacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ValidacionEstado
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Una operación que baja del servidor: payload null si está redactada. */
data class OpDelServidor(
    val opId: String,
    val tipo: String,
    val entidadTipo: String,
    val entidadId: String,
    val hlc: String,
    val payload: JsonObject?,
    val schemaVersion: Int,
    val serverSeq: Long,
    /** El dueño de un adjunto (lo manda el servidor: en una op redactada no se puede sacar del payload). */
    val padreId: String? = null,
)

/** Respuesta del servidor por cada operación de un lote. */
data class RespuestaDeOp(val opId: String, val aceptada: Boolean, val serverSeq: Long?, val hlc: String, val razon: String?)

class Sincronizador(private val cola: Cola, private val horaDelCelular: () -> Long) {
    companion object {
        const val MAX_POR_LOTE = 100
        val TERMINALES = setOf("expense.purge", "fixed.delete", "shortcut.delete", "cashmove.delete")
        const val DEPENDIENTE = "dependiente_de_op_rechazada"
    }

    private val motor = MotorOperaciones(cola)

    private fun viaje() = checkNotNull(cola.viajeLocal()) { "el celular no está vinculado a este viaje" }

    /** Hora corregida con el desfase aprendido del servidor: la que se usa para marcas y para juzgar el cierre. */
    fun ahora(): Long = Reloj.ahoraCorregida(horaDelCelular(), viaje().desfaseMs)

    private fun instante(hlc: String?) = hlc?.let { Reloj.parsear(it) }?.let { Instante(it.ms, it.contador) }

    /** La próxima marca propia; la anota como la última (nunca retrocede). */
    fun nuevaMarca(): String = cola.transaccion {
        val v = viaje()
        val h = Reloj.formatear(Reloj.siguiente(instante(v.hlcUltimo), ahora(), v.dispositivo))
        cola.guardarViajeLocal(v.copy(hlcUltimo = h))
        h
    }

    // ---- registrar -------------------------------------------------------------------------------

    /**
     * Registra una operación propia: formato, viaje cerrado (la app no deja cargar), estado, y la aplica y encola en una
     * transacción. Una terminal (purga, borrado definitivo) no se aplica: queda pendiente y la entidad se oculta hasta que
     * el servidor la confirme.
     */
    fun registrar(op: Operacion): Resultado = cola.transaccion {
        if (Validacion.validar(op) != ResultadoValidacion.Ok) return@transaccion Resultado.Rechazada(Razon.FORMATO)
        if (cola.opConocida(op.opId)) return@transaccion Resultado.Duplicada
        CierreDelViaje.sincronizar(cola, ahora(), null)
        if (op.tipo != "trip.update" && CierreDelViaje.dentroDeUnCierre(cola.intervalosDeCierre(), CierreDelViaje.horaDeCreacion(op))) {
            return@transaccion Resultado.Rechazada(Razon.VIAJE_CERRADO)
        }
        ValidacionEstado.validar(op, cola)?.let { return@transaccion Resultado.Rechazada(it) }
        val dependeDe = dependenciaDe(op)
        val r = if (op.tipo in TERMINALES) {
            if (!cola.entidadExiste(op.entidadTipo, op.entidadId)) return@transaccion Resultado.Rechazada(Razon.ENTIDAD_INEXISTENTE)
            Resultado.Aceptada(cola.guardarOp(OpGuardada(op.opId, op.tipo, op.entidadTipo, op.entidadId, op.hlc, op.payload, false, null, op.schemaVersion)))
        } else {
            motor.aplicar(op)
        }
        if (r is Resultado.Aceptada) {
            cola.fijarEstado(op.opId, EstadoOp.PENDIENTE, dependeDe = dependeDe)
            if (op.tipo == "trip.update") CierreDelViaje.sincronizar(cola, ahora(), CierreDelViaje.horaDeCreacion(op))
        }
        r
    }

    private fun sinConfirmar(o: OpEnCola?) = o != null && o.estado != EstadoOp.CONFIRMADA

    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /**
     * La op propia sin confirmar de la que depende esta: la última de la misma entidad, la del dueño de un adjunto, o el
     * alta de la categoría o la moneda que usa. Si aquella se rechaza, esta también.
     */
    private fun dependenciaDe(op: Operacion): String? {
        val candidatas = mutableListOf<OpEnCola>()
        candidatas += cola.opsDeEntidad(op.entidadTipo, op.entidadId).filter { sinConfirmar(it) }
        texto(op.payload["owner_id"])?.let { dueno ->
            for (t in listOf("expense", "fixed_cost")) candidatas += cola.opsDeEntidad(t, dueno).filter { sinConfirmar(it) }
        }
        texto(op.payload["categoria_id"])?.let { c -> candidatas += cola.opsDeEntidad("category", c).filter { sinConfirmar(it) } }
        for (campo in listOf("moneda", "moneda_sale", "moneda_entra", "moneda_ajuste")) {
            texto(op.payload[campo])?.let { m -> candidatas += cola.opsDeEntidad("trip_currency", m).filter { sinConfirmar(it) } }
        }
        return candidatas.maxByOrNull { it.orden }?.op?.opId
    }

    // ---- subir -----------------------------------------------------------------------------------

    /** Las próximas pendientes que toca subir (en orden), marcadas como en camino. */
    fun armarLote(max: Int = MAX_POR_LOTE): List<OpGuardada> = cola.transaccion {
        val ahora = horaDelCelular()
        // en orden y cortando en la primera que todavía espera: nada sale antes que una anterior (un alta con espera y su edición)
        val lote = cola.enEstado(EstadoOp.PENDIENTE).takeWhile { (it.proximoIntentoEn ?: 0) <= ahora }.take(max)
        for (o in lote) cola.fijarEstado(o.op.opId, EstadoOp.ENVIANDO, dependeDe = o.dependeDe)
        lote.map { it.op }
    }

    /** El lote no llegó (red, 5xx, 413 para partirlo): vuelve a pendientes, con la próxima prueba si se indica. */
    fun loteNoEnviado(opIds: List<String>, proximoIntentoEn: Long?) = cola.transaccion {
        for (id in opIds) {
            val o = cola.buscarEnCola(id) ?: continue
            if (o.estado != EstadoOp.ENVIANDO) continue
            cola.fijarEstado(id, EstadoOp.PENDIENTE, dependeDe = o.dependeDe)
            cola.anotarIntento(id, proximoIntentoEn)
        }
    }

    /** Lo que respondió el servidor a un lote, operación por operación, con su hora para aprender el desfase. */
    fun respuestaDelLote(respuestas: List<RespuestaDeOp>, horaDelServidor: Long?) = cola.transaccion {
        aprenderDesfase(horaDelServidor)
        for (r in respuestas) {
            if (r.aceptada) confirmar(r.opId, checkNotNull(r.serverSeq), r.hlc) else ponerEnCuarentena(r.opId, r.razon ?: "formato")
        }
    }

    private fun aprenderDesfase(horaDelServidor: Long?) {
        if (horaDelServidor == null) return
        val v = viaje()
        cola.guardarViajeLocal(v.copy(desfaseMs = Reloj.aprenderDesfase(horaDelServidor, horaDelCelular())))
    }

    // ---- confirmar -------------------------------------------------------------------------------

    /**
     * Una propia que el servidor aceptó (por la respuesta del envío o porque volvió en la bajada). Si el servidor corrigió
     * su marca, se reescribe y se recalcula la entidad; una terminal recién ahí se aplica de verdad.
     */
    private fun confirmar(opId: String, serverSeq: Long, hlcFinal: String) {
        val o = cola.buscarEnCola(opId) ?: return
        if (o.estado == EstadoOp.CONFIRMADA && o.serverSeq == serverSeq && o.op.hlc == hlcFinal) return
        if (o.op.tipo in TERMINALES) {
            // la terminal diferida se aplica recién ahora, con la marca final, aunque otro ya la haya terminado
            cola.fijarEstado(opId, EstadoOp.PENDIENTE)
            cola.borrarOp(opId)
            terminar(o.op.entidadTipo, o.op.entidadId)
            cola.guardarOp(o.op.copy(hlc = hlcFinal, payload = null, redactada = true))
        } else if (o.op.hlc != hlcFinal) {
            cola.cambiarMarca(opId, hlcFinal)
            recalcularEntidad(o.op.entidadTipo, o.op.entidadId)
        }
        cola.fijarEstado(opId, EstadoOp.CONFIRMADA, serverSeq = serverSeq)
        // si mientras viajaba otro terminó la entidad (o el dueño del adjunto), el servidor la guardó redactada: acá también
        val dueno = o.op.padreId
        if (cola.entidadTerminada(o.op.entidadTipo, o.op.entidadId)) cola.redactarPorEntidad(o.op.entidadTipo, o.op.entidadId)
        if (dueno != null && (cola.entidadTerminada("expense", dueno) || cola.entidadTerminada("fixed_cost", dueno))) cola.redactarPorPadre(dueno)
        if (o.op.hlc != hlcFinal) recalcularUltimaMarca(hlcFinal)
        // estaba en cuarentena y resulta que el servidor la tenía: sus dependientes vuelven a la cola, salvo las que
        // también dependen de otra que sigue rechazada (saldrían solas y volverían a fallar)
        if (o.estado == EstadoOp.CUARENTENA) {
            val otrasRaices = cola.enEstado(EstadoOp.CUARENTENA).filter { it.razon != DEPENDIENTE && it.op.opId != opId }
            val trabadas = otrasRaices.flatMap { dependientes(it.op.opId) }.map { it.op.opId }.toSet()
            for (d in dependientes(opId)) {
                if (d.estado == EstadoOp.CUARENTENA && d.razon == DEPENDIENTE && d.op.opId !in trabadas) {
                    cola.fijarEstado(d.op.opId, EstadoOp.PENDIENTE, dependeDe = d.dependeDe)
                }
            }
        }
    }

    /** Tras una corrección del servidor, la última marca propia baja a la corregida si las anteriores estaban en el futuro. */
    private fun recalcularUltimaMarca(corregida: String) {
        val v = viaje()
        // la mayor entre la corregida, las propias sin confirmar (que se corregirán al subir) y todo lo confirmado, propio o
        // ajeno: nunca por debajo de una marca ya vista, para que lo que se edite después quede ordenado después
        val marcas = EstadoOp.entries.flatMap { cola.enEstado(it) }.map { it.op.hlc } + corregida
        val mayor = marcas.mapNotNull { instante(it) }.maxWith(compareBy({ it.ms }, { it.contador }))
        val actual = instante(v.hlcUltimo)
        val bajar = actual == null || mayor.ms < actual.ms || (mayor.ms == actual.ms && mayor.contador < actual.contador)
        if (bajar) cola.guardarViajeLocal(v.copy(hlcUltimo = Reloj.formatear(Hlc(mayor.ms, mayor.contador, v.dispositivo))))
    }

    // ---- cuarentena, reintentar, descartar -----------------------------------------------------

    /** Las entidades que toca o usa una operación: la suya, el dueño de un adjunto, la categoría y las monedas. */
    private fun referencias(o: OpGuardada): Set<Pair<String, String>> {
        val p = o.payload
        val salida = mutableSetOf(o.entidadTipo to o.entidadId)
        val dueno = o.padreId ?: texto(p?.get("owner_id"))
        if (dueno != null) salida += listOf("expense" to dueno, "fixed_cost" to dueno)
        texto(p?.get("categoria_id"))?.let { salida += "category" to it }
        for (campo in listOf("moneda", "moneda_sale", "moneda_entra", "moneda_ajuste")) texto(p?.get(campo))?.let { salida += "trip_currency" to it }
        return salida
    }

    /**
     * Las propias sin confirmar posteriores que dependen de esta, directa o indirectamente: las que tocan o usan una
     * entidad que tocó alguna de la cadena (no un solo puntero: un gasto puede usar una categoría y una moneda nuevas).
     */
    private fun dependientes(opId: String): List<OpEnCola> {
        val raiz = cola.buscarEnCola(opId) ?: return emptyList()
        val todas = (cola.enEstado(EstadoOp.PENDIENTE) + cola.enEstado(EstadoOp.ENVIANDO) + cola.enEstado(EstadoOp.CUARENTENA))
            .filter { it.orden > raiz.orden }.sortedBy { it.orden }
        val tocadas = mutableSetOf(raiz.op.entidadTipo to raiz.op.entidadId)
        val salida = mutableListOf<OpEnCola>()
        for (o in todas) {
            if (referencias(o.op).any { it in tocadas }) {
                salida += o
                tocadas += o.op.entidadTipo to o.op.entidadId
            }
        }
        return salida
    }

    private fun ponerEnCuarentena(opId: String, razon: String) {
        val o = cola.buscarEnCola(opId) ?: return
        cola.fijarEstado(opId, EstadoOp.CUARENTENA, razon = razon, dependeDe = o.dependeDe)
        for (d in dependientes(opId)) {
            if (d.estado == EstadoOp.PENDIENTE) cola.fijarEstado(d.op.opId, EstadoOp.CUARENTENA, razon = DEPENDIENTE, dependeDe = d.dependeDe)
        }
    }

    /**
     * Vuelve a pendientes una op en cuarentena junto con sus dependientes, en el orden original. Si depende de otra que
     * sigue en cuarentena, se reintenta desde esa (si no, volvería a fallar sola).
     */
    fun reintentar(opId: String) = cola.transaccion {
        val pedida = cola.buscarEnCola(opId) ?: return@transaccion
        if (pedida.estado != EstadoOp.CUARENTENA) return@transaccion
        // la raíz: la primera en cuarentena de la que depende (por cualquier referencia), o ella misma
        val o = cola.enEstado(EstadoOp.CUARENTENA).filter { it.orden < pedida.orden }
            .firstOrNull { raiz -> dependientes(raiz.op.opId).any { it.op.opId == opId } } ?: pedida
        val opId = o.op.opId
        for (x in listOf(o) + dependientes(opId)) {
            if (x.estado == EstadoOp.CUARENTENA) cola.fijarEstado(x.op.opId, EstadoOp.PENDIENTE, dependeDe = x.dependeDe)
        }
    }

    /** Descarta una op que el servidor no tiene (y sus dependientes) y revierte su efecto local. */
    fun descartar(opId: String) = cola.transaccion {
        val o = cola.buscarEnCola(opId) ?: return@transaccion
        // una pendiente que ya salió alguna vez pudo haber llegado (se perdió la respuesta): no se descarta sin saberlo
        check(o.estado == EstadoOp.CUARENTENA || (o.estado == EstadoOp.PENDIENTE && o.intentos == 0)) { "solo se descarta una op que el servidor no tiene" }
        val todas = (listOf(o) + dependientes(opId)).filter { it.estado == EstadoOp.CUARENTENA || (it.estado == EstadoOp.PENDIENTE && it.intentos == 0) }
        for (x in todas.sortedByDescending { it.orden }) cola.borrarOp(x.op.opId)
        for ((tipo, id) in todas.map { it.op.entidadTipo to it.op.entidadId }.distinct()) recalcularEntidad(tipo, id)
    }

    // ---- recalcular ------------------------------------------------------------------------------

    /**
     * Rehace la entidad desde las operaciones que quedan en el registro (sin las terminales diferidas): gana por campo la de
     * mayor marca, como en el motor. Si no queda ninguna operación que la cree, la entidad desaparece.
     */
    fun recalcularEntidad(tipo: String, id: String) {
        val registro = cola.opsDeEntidad(tipo, id)
        // una lápida sin ninguna op de la entidad en el registro vino de algo propio que se descartó (por ejemplo, el
        // adjunto de un gasto que otro purgó): el servidor nunca la tuvo
        if (cola.entidadTerminada(tipo, id) && registro.isEmpty()) cola.quitarLapida(tipo, id)
        if (cola.entidadTerminada(tipo, id)) return
        val ops = registro.filter { it.op.payload != null && it.op.tipo !in TERMINALES }
        cola.borrarEntidad(tipo, id)
        if (ops.none { it.op.tipo.endsWith(".create") || it.op.tipo == "member.join" || it.op.tipo == "currency.enable" || it.op.tipo == "attachment.add" }) return
        cola.crearEntidad(tipo, id)
        for (o in ops.sortedBy { it.op.hlc }) {
            for ((campo, valor) in o.op.payload!!) {
                if (o.op.tipo == "trip.create" && campo == "monedas") continue
                val actual = cola.leerReloj(tipo, id, campo)
                if (actual != null && o.op.hlc <= actual) continue
                cola.escribirCampo(tipo, id, campo, valor, o.op.hlc)
                if (o.op.tipo == "currency.update" && campo == "efectivo_inicial_minor") {
                    cola.escribirCampo(tipo, id, "efectivo_inicial_en", if (valor is JsonNull) JsonNull else JsonPrimitive(Reloj.parsear(o.op.hlc)!!.ms), o.op.hlc)
                }
            }
        }
    }

    // ---- bajar -----------------------------------------------------------------------------------

    /**
     * Aplica una página de lo que bajó, en una transacción: las propias se confirman (con su marca final) y las ajenas se
     * aplican sin volver a validar (el servidor ya las aceptó). Nunca rechaza. Guarda la última secuencia y aprende la hora.
     */
    fun aplicarBajada(ops: List<OpDelServidor>, horaDelServidor: Long?) = cola.transaccion {
        aprenderDesfase(horaDelServidor)
        var ultimo = viaje().ultimoSeq
        for (o in ops.sortedBy { it.serverSeq }) {
            if (o.serverSeq <= ultimo) continue
            val propia = cola.buscarEnCola(o.opId)
            if (propia != null) {
                if (propia.estado != EstadoOp.CONFIRMADA || propia.serverSeq != o.serverSeq) confirmar(o.opId, o.serverSeq, o.hlc)
            } else {
                aplicarAjena(o)
            }
            observar(o.hlc)
            ultimo = o.serverSeq
        }
        cola.guardarViajeLocal(viaje().copy(ultimoSeq = ultimo, ultimaSyncOkEn = horaDelCelular()))
    }

    private fun aplicarAjena(o: OpDelServidor) {
        if (o.payload != null) {
            val r = motor.aplicar(Operacion(o.opId, o.tipo, o.entidadTipo, o.entidadId, o.hlc, o.payload, o.schemaVersion))
            if (r !is Resultado.Rechazada) {
                cola.fijarEstado(o.opId, EstadoOp.CONFIRMADA, serverSeq = o.serverSeq)
                return
            }
            // el motor la rechaza por algo propio sin confirmar (por ejemplo, un adjunto con el mismo id y otro dueño): el
            // servidor ya la aceptó, así que se guarda con sus datos y la entidad se rehace desde el registro
            if (o.tipo !in TERMINALES) {
                cola.guardarOp(OpGuardada(o.opId, o.tipo, o.entidadTipo, o.entidadId, o.hlc, o.payload, false, o.padreId, o.schemaVersion))
                cola.fijarEstado(o.opId, EstadoOp.CONFIRMADA, serverSeq = o.serverSeq)
                recalcularEntidad(o.entidadTipo, o.entidadId)
                return
            }
        }
        // redactada (o algo que el motor no pudo aplicar): se guarda como está; una terminal igual termina la entidad,
        // aunque el celular nunca la haya visto viva (su alta bajó ya redactada)
        if (o.tipo in TERMINALES) terminar(o.entidadTipo, o.entidadId)
        // un adjunto agregado a un dueño ya purgado nace terminado (el servidor lo guardó así)
        val dueno = o.padreId
        if (o.tipo == "attachment.add" && dueno != null && (cola.entidadTerminada("expense", dueno) || cola.entidadTerminada("fixed_cost", dueno))) {
            cola.terminar(o.entidadTipo, o.entidadId)
        }
        if (!cola.opConocida(o.opId)) cola.guardarOp(OpGuardada(o.opId, o.tipo, o.entidadTipo, o.entidadId, o.hlc, null, true, o.padreId, o.schemaVersion))
        cola.fijarEstado(o.opId, EstadoOp.CONFIRMADA, serverSeq = o.serverSeq)
    }

    /** Lo que hace el motor con una terminal, sin exigir que la entidad exista: adjuntos, lápida y redacción. */
    private fun terminar(tipo: String, id: String) {
        if (cola.entidadTerminada(tipo, id)) return
        if (tipo == "expense" || tipo == "fixed_cost") {
            // los adjuntos vivos y también los que el celular solo conoce por una op redactada (su alta bajó sin datos)
            val adjuntos = cola.adjuntosDe(id) + cola.opsConPadre(id).filter { it.op.entidadTipo == "attachment" }.map { it.op.entidadId }
            for (adjunto in adjuntos.distinct()) cola.terminar("attachment", adjunto)
            cola.redactarPorPadre(id)
        }
        cola.terminar(tipo, id)
        cola.redactarPorEntidad(tipo, id)
    }

    /** Regla de recibir: la última marca propia pasa a ser la mayor entre la propia y la vista. */
    private fun observar(hlc: String) {
        val v = viaje()
        val visto = instante(hlc) ?: return
        val nueva = Reloj.observar(instante(v.hlcUltimo), visto)
        val ultimo = instante(v.hlcUltimo)
        if (ultimo == null || nueva != ultimo) cola.guardarViajeLocal(v.copy(hlcUltimo = Reloj.formatear(Hlc(nueva.ms, nueva.contador, v.dispositivo))))
    }
}
