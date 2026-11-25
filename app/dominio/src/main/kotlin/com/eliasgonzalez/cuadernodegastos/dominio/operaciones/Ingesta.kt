// Validación contra el estado, cierre del viaje por intervalos e ingesta de una operación: lo mismo que decide el
// servidor al recibirla. En la app sirve para avisar antes de encolar (y para el simulador); manda el servidor.
package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.PlanDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

data class IntervaloCierre(val desdeMs: Long, val hastaMs: Long?, val causa: Causa) {
    enum class Causa { MANUAL, FECHAS }
}

object ValidacionEstado {
    const val MAX_ADJUNTOS_ACTIVOS = 3
    const val MAX_ATAJOS = 6

    private val CAMPOS_DE_MONEDA = listOf("moneda", "moneda_sale", "moneda_entra", "moneda_ajuste")

    private fun texto(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Razón por la que el estado no admite la operación, o null. Lo ya terminado no se mira (el motor lo redacta). */
    fun validar(op: Operacion, estado: Almacen): Razon? {
        val tipo = op.entidadTipo
        val id = op.entidadId
        val p = op.payload
        if (estado.entidadTerminada(tipo, id)) return null
        for (campo in CAMPOS_DE_MONEDA) {
            val moneda = texto(p[campo])
            if (moneda != null && !estado.entidadExiste("trip_currency", moneda)) return Razon.MONEDA_NO_HABILITADA
        }
        val categoria = texto(p["categoria_id"])
        if (categoria != null && !estado.entidadExiste("category", categoria)) return Razon.ENTIDAD_INEXISTENTE

        if (op.tipo == "attachment.add") {
            // el propio adjunto no cuenta: repetir su alta no agrega uno más
            val dueno = texto(p["owner_id"]).orEmpty() // la validación de formato ya exige un UUID
            val activos = estado.adjuntosDe(dueno).filter { it != id && !esUno(estado.leerCampo("attachment", it, "quitado")) }
            if (activos.size >= MAX_ADJUNTOS_ACTIVOS) return Razon.LIMITE_SUPERADO
        }
        if (op.tipo == "shortcut.create" && !estado.entidadExiste("shortcut", id) && estado.contarEntidades("shortcut") >= MAX_ATAJOS) return Razon.LIMITE_SUPERADO

        if (op.tipo == "cashmove.update") {
            val tipoDelMovimiento = texto(estado.leerCampo("cash_movement", id, "tipo"))
            if (tipoDelMovimiento != null) {
                val dinero = Validacion.DINERO_DEL_MOVIMIENTO[tipoDelMovimiento].orEmpty()
                if (p.keys.any { it != "cuando" && it != "nota" && it !in dinero }) return Razon.FORMATO
                if (tipoDelMovimiento == "CAMBIO") {
                    // lo que quedaría tras resolver los relojes: una de las dos monedas podría perder contra una edición más nueva
                    fun quedaria(campo: String): JsonElement? {
                        val nuevo = p[campo]
                        val reloj = estado.leerReloj("cash_movement", id, campo)
                        return if (nuevo != null && (reloj == null || op.hlc > reloj)) nuevo else estado.leerCampo("cash_movement", id, campo)
                    }
                    if (mismoValor(quedaria("moneda_sale"), quedaria("moneda_entra"))) return Razon.FORMATO
                }
            }
        }
        return null
    }

    // `=== 1` de JavaScript: el número 1 (también escrito 1.0), no el texto "1"
    private fun esUno(v: JsonElement?) = v is JsonPrimitive && !v.isString && v.content.toDoubleOrNull() == 1.0

    // `===` de JavaScript entre dos monedas (textos; dos ausentes son iguales)
    private fun mismoValor(a: JsonElement?, b: JsonElement?) = texto(a) == texto(b) && (a == null) == (b == null)
}

object CierreDelViaje {
    fun dentroDeUnCierre(intervalos: List<IntervaloCierre>, ms: Long) = intervalos.any { ms >= it.desdeMs && (it.hastaMs == null || ms < it.hastaMs) }

    private fun texto(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** El plan del viaje tal como está en el almacén; null si el viaje no existe. */
    fun planDelViaje(almacen: Almacen, id: String): PlanDelViaje? {
        val zona = texto(almacen.leerCampo("trip", id, "zona_horaria")) ?: return null
        val manual = when (texto(almacen.leerCampo("trip", id, "estado_manual"))) {
            "EN_CURSO" -> EstadoViaje.EN_CURSO
            "CERRADO" -> EstadoViaje.CERRADO
            else -> null
        }
        return PlanDelViaje(manual, texto(almacen.leerCampo("trip", id, "fecha_inicio")), texto(almacen.leerCampo("trip", id, "fecha_fin")), zona)
    }

    /**
     * Hace que los intervalos reflejen el estado actual del viaje. `momentoMs` es la hora de creación de la operación
     * que acaba de cambiar el plan, o null si nadie lo cambió. Igual que en el servidor.
     */
    fun sincronizar(almacen: Almacen, ahoraMs: Long, momentoMs: Long?) {
        val id = almacen.idDelViaje() ?: return
        val plan = planDelViaje(almacen, id) ?: return
        val intervalos = almacen.intervalosDeCierre()
        val abierto = intervalos.lastOrNull()
        val hayAbierto = abierto != null && abierto.hastaMs == null
        val cerrado = EstadoDelViaje.estado(plan, ahoraMs) == EstadoViaje.CERRADO
        if (cerrado && !hayAbierto) {
            val finDelAnterior = abierto?.hastaMs ?: 0
            val manual = plan.estadoManual == EstadoViaje.CERRADO
            val inicio = if (manual) momentoMs ?: ahoraMs else maxOf(EstadoDelViaje.cierrePorFechas(plan.fechaFin, plan.zonaHoraria)!!, momentoMs ?: 0)
            almacen.abrirIntervalo(maxOf(inicio, finDelAnterior), if (manual) IntervaloCierre.Causa.MANUAL else IntervaloCierre.Causa.FECHAS)
        } else if (!cerrado && hayAbierto && momentoMs != null) {
            // solo una operación que cambia el plan reabre; si el reloj retrocedió sin cambios, el cierre sigue
            almacen.cerrarIntervalo(maxOf(momentoMs, abierto.desdeMs + 1))
        }
    }

    /** Hora de creación de la operación (milisegundos de su marca). */
    fun horaDeCreacion(op: Operacion): Long = Reloj.parsear(op.hlc)?.ms ?: 0
}

/**
 * Ingesta de una operación: formato, duplicado, cierre del viaje, estado y aplicar, todo en una transacción.
 * En la app, `ahora` debe ser la hora corregida con el desfase del servidor (`Reloj.ahoraCorregida`), no la del celular.
 */
class Ingesta(private val almacen: Almacen, private val ahora: () -> Long = System::currentTimeMillis) {
    private val motor = MotorOperaciones(almacen)

    fun procesar(op: Operacion): Resultado = almacen.transaccion {
        if (Validacion.validar(op) != ResultadoValidacion.Ok) return@transaccion Resultado.Rechazada(Razon.FORMATO)
        if (almacen.opConocida(op.opId)) return@transaccion Resultado.Duplicada
        // si el viaje ya terminó por fechas y nadie lo había anotado, se abre el intervalo antes de juzgar
        CierreDelViaje.sincronizar(almacen, ahora(), null)
        if (op.tipo != "trip.update" && !almacen.entidadTerminada(op.entidadTipo, op.entidadId) &&
            CierreDelViaje.dentroDeUnCierre(almacen.intervalosDeCierre(), CierreDelViaje.horaDeCreacion(op))
        ) {
            return@transaccion Resultado.Rechazada(Razon.VIAJE_CERRADO)
        }
        ValidacionEstado.validar(op, almacen)?.let { return@transaccion Resultado.Rechazada(it) }
        val resultado = motor.aplicar(op)
        if (resultado is Resultado.Aceptada && (op.tipo == "trip.create" || op.tipo == "trip.update")) {
            CierreDelViaje.sincronizar(almacen, ahora(), CierreDelViaje.horaDeCreacion(op))
        }
        resultado
    }
}
