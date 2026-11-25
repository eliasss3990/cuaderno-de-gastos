// Almacén en memoria del estado del viaje: sirve a las pruebas y como referencia de lo que debe cumplir cualquier
// otro almacén (por ejemplo la base del celular). `instantanea` da una vista ordenada para comparar.
package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class AlmacenMemoria : Almacen {
    private class Entidad(val tipo: String, val id: String, val campos: MutableMap<String, JsonElement> = HashMap(), val relojes: MutableMap<String, String> = HashMap())

    private data class Clave(val tipo: String, val id: String) : Comparable<Clave> {
        override fun compareTo(other: Clave) = compareValuesBy(this, other, { it.tipo }, { it.id })
    }

    private val entidades = HashMap<Clave, Entidad>()
    private val lapidas = HashSet<Clave>()
    private val ops = LinkedHashMap<String, OpLeida>()
    private val marcas = HashSet<String>()
    private var seq = 0L

    /** Pasos para deshacer lo hecho dentro de la transacción en curso (null si no hay ninguna). */
    private var diario: MutableList<() -> Unit>? = null

    override fun <T> transaccion(fn: () -> T): T {
        // ya hay una en curso: forma parte de ella (sin punto de guardado propio; el motor no anida)
        if (diario != null) return fn()
        val pasos = mutableListOf<() -> Unit>()
        diario = pasos
        try {
            return fn().also { diario = null }
        } catch (e: Throwable) { // también un Error: si no, el diario quedaría abierto para siempre
            diario = null
            pasos.asReversed().forEach { it() }
            throw e
        }
    }

    private fun deshacer(paso: () -> Unit) {
        diario?.add(paso)
    }

    override fun opConocida(opId: String) = opId in ops

    override fun marcaEnUso(hlc: String) = hlc in marcas

    override fun entidadExiste(tipo: String, id: String) = Clave(tipo, id) in entidades

    override fun entidadTerminada(tipo: String, id: String) = Clave(tipo, id) in lapidas

    override fun leerCampo(tipo: String, id: String, campo: String) = entidades[Clave(tipo, id)]?.campos?.get(campo)

    override fun leerReloj(tipo: String, id: String, campo: String) = entidades[Clave(tipo, id)]?.relojes?.get(campo)

    override fun crearEntidad(tipo: String, id: String) {
        val k = Clave(tipo, id)
        if (k in entidades) return
        entidades[k] = Entidad(tipo, id)
        deshacer { entidades.remove(k) }
    }

    override fun escribirCampo(tipo: String, id: String, campo: String, valor: JsonElement, hlc: String) {
        val e = checkNotNull(entidades[Clave(tipo, id)]) { "la entidad $tipo/$id no existe" }
        val valorAntes = e.campos[campo]
        val relojAntes = e.relojes[campo]
        e.campos[campo] = valor
        e.relojes[campo] = hlc
        deshacer {
            if (valorAntes != null && relojAntes != null) {
                e.campos[campo] = valorAntes
                e.relojes[campo] = relojAntes
            } else {
                e.campos.remove(campo)
                e.relojes.remove(campo)
            }
        }
    }

    override fun adjuntosDe(ownerId: String): List<String> = entidades.values
        .filter { it.tipo == "attachment" && it.campos["owner_id"] == JsonPrimitive(ownerId) }
        .map { it.id }
        .sorted()

    override fun terminar(tipo: String, id: String) {
        val k = Clave(tipo, id)
        val antes = entidades.remove(k)
        val nueva = lapidas.add(k)
        deshacer {
            if (antes != null) entidades[k] = antes
            if (nueva) lapidas.remove(k)
        }
    }

    private fun redactar(coincide: (OpGuardada) -> Boolean) {
        val cambiadas = ops.filterValues { coincide(it.op) }
        for ((k, o) in cambiadas) ops[k] = o.copy(op = o.op.copy(payload = null, redactada = true))
        deshacer { ops.putAll(cambiadas) }
    }

    override fun redactarPorEntidad(tipo: String, id: String) = redactar { it.entidadTipo == tipo && it.entidadId == id }

    override fun redactarPorPadre(padreId: String) = redactar { it.padreId == padreId }

    override fun padreRegistrado(tipo: String, id: String): String? =
        ops.values.firstOrNull { it.op.entidadTipo == tipo && it.op.entidadId == id && it.op.padreId != null }?.op?.padreId

    override fun guardarOp(op: OpGuardada): Long {
        check(op.opId !in ops) { "la operación ${op.opId} ya está guardada" }
        check(op.hlc !in marcas) { "la marca ${op.hlc} ya la usa otra operación" }
        seq += 1
        val numero = seq
        ops[op.opId] = OpLeida(op, numero)
        marcas.add(op.hlc)
        deshacer {
            ops.remove(op.opId)
            marcas.remove(op.hlc)
            seq = numero - 1
        }
        return numero
    }

    /** Números de secuencia de las operaciones guardadas, ordenados (para comprobar que no hay huecos). */
    fun secuencias(): List<Long> = ops.values.map { it.seq }.sorted()

    /** Vista ordenada del estado, en la misma forma JSON que la de los vectores (sin secuencias ni versión). */
    fun instantanea(): JsonObject {
        fun texto(s: String?) = if (s == null) JsonNull else JsonPrimitive(s)
        val ents = entidades.keys.sorted().map { k ->
            val e = entidades.getValue(k)
            JsonObject(
                mapOf(
                    "tipo" to JsonPrimitive(e.tipo),
                    "id" to JsonPrimitive(e.id),
                    "campos" to JsonObject(e.campos.toSortedMap()),
                    "relojes" to JsonObject(e.relojes.toSortedMap().mapValues { JsonPrimitive(it.value) }),
                ),
            )
        }
        val laps = lapidas.sorted().map { JsonObject(mapOf("tipo" to JsonPrimitive(it.tipo), "id" to JsonPrimitive(it.id))) }
        val lista = ops.values.map { it.op }.sortedBy { it.opId }.map { o ->
            JsonObject(
                mapOf(
                    "opId" to JsonPrimitive(o.opId),
                    "tipo" to JsonPrimitive(o.tipo),
                    "entidadTipo" to JsonPrimitive(o.entidadTipo),
                    "entidadId" to JsonPrimitive(o.entidadId),
                    "hlc" to JsonPrimitive(o.hlc),
                    "payload" to (o.payload ?: JsonNull),
                    "redactada" to JsonPrimitive(o.redactada),
                    "padreId" to texto(o.padreId),
                ),
            )
        }
        return JsonObject(mapOf("entidades" to JsonArray(ents), "lapidas" to JsonArray(laps), "ops" to JsonArray(lista)))
    }
}
