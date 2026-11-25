// Aplicar una operación al estado del viaje. Cada campo de una entidad es un registro de "gana el último" ordenado por
// el reloj híbrido: una edición se aplica solo si su marca es mayor que la guardada para ese campo. El resultado no
// depende del orden de llegada de las ediciones ni de los duplicados. Es el mismo motor que el del servidor.
// No valida formatos ni límites de negocio (eso va antes): solo lo estructural para no corromper el estado.
package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

enum class Razon(val codigo: String) {
    FORMATO("formato"),
    ENTIDAD_INEXISTENTE("entidad_inexistente"),
    MONEDA_NO_HABILITADA("moneda_no_habilitada"),
    LIMITE_SUPERADO("limite_superado"),
    VIAJE_CERRADO("viaje_cerrado"),
}

sealed interface Resultado {
    data class Aceptada(val seq: Long) : Resultado

    data object Duplicada : Resultado

    data class Rechazada(val razon: Razon) : Resultado
}

/** Lo que se guarda de una operación aplicada. Si fue redactada, el payload es null. */
data class OpGuardada(
    val opId: String,
    val tipo: String,
    val entidadTipo: String,
    val entidadId: String,
    val hlc: String,
    val payload: JsonObject?,
    val redactada: Boolean,
    val padreId: String?,
    val schemaVersion: Int,
)

/** Una operación guardada con su número de secuencia. */
data class OpLeida(val op: OpGuardada, val seq: Long)

/** El almacén del estado del viaje (puerto): en memoria para las pruebas, en la base del celular en la app. */
interface Almacen {
    /** Ejecuta `fn` como una unidad: si lanza una excepción se deshace todo lo escrito dentro. */
    fun <T> transaccion(fn: () -> T): T

    fun opConocida(opId: String): Boolean

    /** Si alguna operación guardada (también las redactadas) usa esa marca. */
    fun marcaEnUso(hlc: String): Boolean

    fun entidadExiste(tipo: String, id: String): Boolean

    fun entidadTerminada(tipo: String, id: String): Boolean

    /** Valor actual de un campo, o null si no existe la entidad o el campo no tiene valor (distinto del JSON null). */
    fun leerCampo(tipo: String, id: String, campo: String): JsonElement?

    fun leerReloj(tipo: String, id: String, campo: String): String?

    /** Crea la entidad vacía si no existe (no hace nada si ya existe). */
    fun crearEntidad(tipo: String, id: String)

    fun escribirCampo(tipo: String, id: String, campo: String, valor: JsonElement, hlc: String)

    /** Identificadores (ordenados) de los adjuntos, también los quitados, cuyo dueño es `ownerId`. */
    fun adjuntosDe(ownerId: String): List<String>

    /** Borra la entidad (si existe) con sus campos y relojes y anota la lápida. Sirve aunque nunca existiera. */
    fun terminar(tipo: String, id: String)

    /** Deja sin payload las operaciones guardadas de esa entidad. */
    fun redactarPorEntidad(tipo: String, id: String)

    /** Deja sin payload las operaciones guardadas cuyo padre es `padreId`. */
    fun redactarPorPadre(padreId: String)

    /** Padre registrado en el sobre de alguna operación guardada de esa entidad (sobrevive a la redacción). */
    fun padreRegistrado(tipo: String, id: String): String?

    /** Guarda la operación y devuelve su número de secuencia (1, 2, 3… sin huecos). */
    fun guardarOp(op: OpGuardada): Long
}

private enum class Clase { CREAR, EDITAR, TERMINAL, MONEDA }

private data class MonedaDelViaje(val codigo: String, val decimales: Long, val simbolo: String)

class MotorOperaciones(private val almacen: Almacen) {
    companion object {
        /** Categoría que nace con el viaje; tiene el mismo id en todos los dispositivos. */
        const val CATEGORIA_OTRO = "otro"

        private val DEFINICIONES: Map<String, Pair<String, Clase>> = mapOf(
            "trip.create" to ("trip" to Clase.CREAR),
            "trip.update" to ("trip" to Clase.EDITAR),
            "currency.enable" to ("trip_currency" to Clase.CREAR),
            "currency.disable" to ("trip_currency" to Clase.MONEDA),
            "currency.update" to ("trip_currency" to Clase.MONEDA),
            "member.join" to ("member" to Clase.CREAR),
            "member.update" to ("member" to Clase.EDITAR),
            "category.create" to ("category" to Clase.CREAR),
            "category.update" to ("category" to Clase.EDITAR),
            "category.archive" to ("category" to Clase.EDITAR),
            "expense.create" to ("expense" to Clase.CREAR),
            "expense.update" to ("expense" to Clase.EDITAR),
            "expense.delete" to ("expense" to Clase.EDITAR),
            "expense.restore" to ("expense" to Clase.EDITAR),
            "expense.purge" to ("expense" to Clase.TERMINAL),
            "fixed.create" to ("fixed_cost" to Clase.CREAR),
            "fixed.update" to ("fixed_cost" to Clase.EDITAR),
            "fixed.delete" to ("fixed_cost" to Clase.TERMINAL),
            "attachment.add" to ("attachment" to Clase.CREAR),
            "attachment.remove" to ("attachment" to Clase.EDITAR),
            "shortcut.create" to ("shortcut" to Clase.CREAR),
            "shortcut.update" to ("shortcut" to Clase.EDITAR),
            "shortcut.delete" to ("shortcut" to Clase.TERMINAL),
            "cashmove.create" to ("cash_movement" to Clase.CREAR),
            "cashmove.update" to ("cash_movement" to Clase.EDITAR),
            "cashmove.delete" to ("cash_movement" to Clase.TERMINAL),
        )

        /** Entidades que pueden tener adjuntos, según el `owner_tipo` del adjunto. */
        private val DUENOS = mapOf("EXPENSE" to "expense", "FIXED_COST" to "fixed_cost")

        /** Operaciones que tocan un solo campo: no pueden traer otros (así nadie escribe a mano campos derivados). */
        private val SOLO_CAMPOS: Map<String, List<String>> = mapOf(
            "currency.update" to listOf("tope_minor", "efectivo_inicial_minor"),
            "currency.disable" to listOf("habilitada"),
            "category.archive" to listOf("archivada"),
            "expense.delete" to listOf("eliminado"),
            "expense.restore" to listOf("eliminado"),
            "attachment.remove" to listOf("quitado"),
        )

        private fun texto(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

        /** Las monedas del alta del viaje, o null si la lista no tiene la forma esperada. */
        private fun leerMonedas(valor: JsonElement?): List<MonedaDelViaje>? {
            if (valor == null) return emptyList()
            if (valor !is JsonArray) return null
            val codigos = HashSet<String>()
            return valor.map { m ->
                if (m !is JsonObject) return null
                val codigo = texto(m["codigo"])?.takeIf { it.isNotEmpty() } ?: return null
                // Number.isInteger: un número con valor entero (1.0 también)
                val d = (m["decimales"] as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.content?.toDoubleOrNull() ?: return null
                if (d.isInfinite() || d != Math.floor(d)) return null
                val simbolo = texto(m["simbolo"]) ?: return null
                if (!codigos.add(codigo)) return null // una moneda repetida no tiene un valor único
                MonedaDelViaje(codigo, d.toLong(), simbolo)
            }
        }
    }

    /** Aplica la operación como una unidad: o queda todo escrito o no queda nada. */
    fun aplicar(op: Operacion): Resultado = almacen.transaccion { decidir(op) }

    private fun decidir(op: Operacion): Resultado {
        val (tipo, clase) = DEFINICIONES[op.tipo] ?: return Resultado.Rechazada(Razon.FORMATO)
        if (tipo != op.entidadTipo || op.entidadId.isEmpty() || op.opId.isEmpty()) return Resultado.Rechazada(Razon.FORMATO)
        val marca = Reloj.parsear(op.hlc) ?: return Resultado.Rechazada(Razon.FORMATO)
        val a = almacen
        if (a.opConocida(op.opId)) return Resultado.Duplicada
        // la marca es única por operación: dos distintas con la misma harían depender el estado del orden de llegada
        if (a.marcaEnUso(op.hlc)) return Resultado.Rechazada(Razon.FORMATO)
        val claves = op.payload.keys
        SOLO_CAMPOS[op.tipo]?.let { permitidos -> if (claves.any { it !in permitidos }) return Resultado.Rechazada(Razon.FORMATO) }
        // `efectivo_inicial_en` es derivado (solo lo escribe el motor) y el dueño solo se fija al agregar el adjunto
        if ("efectivo_inicial_en" in claves) return Resultado.Rechazada(Razon.FORMATO)
        if (op.tipo != "attachment.add" && ("owner_tipo" in claves || "owner_id" in claves)) return Resultado.Rechazada(Razon.FORMATO)

        val id = op.entidadId
        // un adjunto cuelga de un gasto o de un gasto fijo: ese dueño es su "padre"
        var padreId: String? = null
        var duenoTipo: String? = null
        if (op.tipo == "attachment.add") {
            val dt = DUENOS[texto(op.payload["owner_tipo"]) ?: ""]
            val oid = texto(op.payload["owner_id"])
            if (dt == null || oid.isNullOrEmpty()) return Resultado.Rechazada(Razon.FORMATO)
            duenoTipo = dt
            padreId = oid
            // el dueño de un adjunto no cambia: una segunda alta con otro dueño es un error del cliente
            val previo = a.padreRegistrado(tipo, id)
            if (previo != null && previo != padreId) return Resultado.Rechazada(Razon.FORMATO)
        } else if (tipo == "attachment") {
            padreId = a.padreRegistrado(tipo, id)
        }

        if (clase == Clase.TERMINAL) return terminar(op, padreId)

        // operaciones sobre algo ya terminado: se aceptan, se guardan redactadas y no cambian nada
        if (a.entidadTerminada(tipo, id)) return guardarRedactada(op, padreId)
        if (duenoTipo != null && padreId != null) {
            if (a.entidadTerminada(duenoTipo, padreId)) {
                a.terminar(tipo, id) // el adjunto de un dueño ya purgado nace terminado
                return guardarRedactada(op, padreId)
            }
            if (!a.entidadExiste(duenoTipo, padreId)) return Resultado.Rechazada(Razon.ENTIDAD_INEXISTENTE)
        }

        if (clase == Clase.EDITAR && !a.entidadExiste(tipo, id)) return Resultado.Rechazada(Razon.ENTIDAD_INEXISTENTE)
        if (clase == Clase.MONEDA && !a.entidadExiste(tipo, id)) return Resultado.Rechazada(Razon.MONEDA_NO_HABILITADA)

        var monedas = emptyList<MonedaDelViaje>()
        if (op.tipo == "trip.create") monedas = leerMonedas(op.payload["monedas"]) ?: return Resultado.Rechazada(Razon.FORMATO)

        if (clase == Clase.CREAR) a.crearEntidad(tipo, id)
        for ((campo, valor) in op.payload) {
            if (op.tipo == "trip.create" && campo == "monedas") continue
            val gano = escribir(tipo, id, campo, valor, op.hlc)
            if (gano && op.tipo == "currency.update" && campo == "efectivo_inicial_minor") {
                a.escribirCampo(tipo, id, "efectivo_inicial_en", if (valor is JsonNull) JsonNull else JsonPrimitive(marca.ms), op.hlc)
            }
        }
        if (op.tipo == "trip.create") crearViaje(op.hlc, monedas)
        return Resultado.Aceptada(a.guardarOp(guardada(op, padreId, op.payload)))
    }

    /** Escribe el campo solo si la marca es mayor que la guardada. */
    private fun escribir(tipo: String, id: String, campo: String, valor: JsonElement, hlc: String): Boolean {
        val actual = almacen.leerReloj(tipo, id, campo)
        if (actual != null && hlc <= actual) return false
        almacen.escribirCampo(tipo, id, campo, valor, hlc)
        return true
    }

    /** Al crear el viaje nacen la categoría "Otro" y una moneda habilitada por cada moneda del viaje. */
    private fun crearViaje(hlc: String, monedas: List<MonedaDelViaje>) {
        almacen.crearEntidad("category", CATEGORIA_OTRO)
        escribir("category", CATEGORIA_OTRO, "nombre", JsonPrimitive("Otro"), hlc)
        escribir("category", CATEGORIA_OTRO, "emoji", JsonPrimitive("📦"), hlc)
        escribir("category", CATEGORIA_OTRO, "color", JsonPrimitive("#EEE8D8"), hlc)
        escribir("category", CATEGORIA_OTRO, "archivada", JsonPrimitive(0), hlc)
        for (m in monedas) {
            almacen.crearEntidad("trip_currency", m.codigo)
            escribir("trip_currency", m.codigo, "habilitada", JsonPrimitive(1), hlc)
            escribir("trip_currency", m.codigo, "decimales", JsonPrimitive(m.decimales), hlc)
            escribir("trip_currency", m.codigo, "simbolo", JsonPrimitive(m.simbolo), hlc)
        }
    }

    private fun terminar(op: Operacion, padreId: String?): Resultado {
        val a = almacen
        val tipo = op.entidadTipo
        val id = op.entidadId
        if (a.entidadTerminada(tipo, id)) return guardarRedactada(op, padreId)
        if (!a.entidadExiste(tipo, id)) return Resultado.Rechazada(Razon.ENTIDAD_INEXISTENTE)
        if (tipo == "expense" || tipo == "fixed_cost") {
            for (adjunto in a.adjuntosDe(id)) a.terminar("attachment", adjunto)
            a.redactarPorPadre(id) // las operaciones de todos sus adjuntos llevan al dueño como padre
        }
        a.terminar(tipo, id)
        a.redactarPorEntidad(tipo, id)
        return guardarRedactada(op, padreId)
    }

    private fun guardarRedactada(op: Operacion, padreId: String?): Resultado = Resultado.Aceptada(almacen.guardarOp(guardada(op, padreId, null)))

    private fun guardada(op: Operacion, padreId: String?, payload: JsonObject?) =
        OpGuardada(op.opId, op.tipo, op.entidadTipo, op.entidadId, op.hlc, payload, payload == null, padreId, op.schemaVersion)
}
