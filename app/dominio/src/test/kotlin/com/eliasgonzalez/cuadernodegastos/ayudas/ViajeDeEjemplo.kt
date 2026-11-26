package com.eliasgonzalez.cuadernodegastos.ayudas

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Ingesta
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals

/** El viaje de ejemplo de las pantallas de referencia (día 4, jueves 18 de febrero de 2027), cargado en un almacén. */
object ViajeDeEjemplo {
    const val VIAJE = "018f3a6e-1000-7000-8000-000000000001"

    /** 2027-02-18 14:32 en Asunción. */
    const val HOY_MS = 1802971920000L

    class Cargado(val almacen: AlmacenMemoria, val vectores: JsonObject) {
        /** El id de integrante de cada clave del ejemplo (papa, mama, nico, lu). */
        val integrantes: Map<String, String> = vectores["integrantes"]!!.jsonObject.mapValues { texto(it.value.jsonObject["member_id"])!! }
    }

    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Carga el viaje con la ingesta, cada operación desde el dispositivo de quien la registra y con su autor. */
    fun cargar(): Cargado {
        val v = Vectores.leer("viaje-de-ejemplo.json")
        val almacen = AlmacenMemoria()
        val ingesta = Ingesta(almacen) { HOY_MS }
        val claves = v["integrantes"]!!.jsonObject
        val dispositivos = claves.keys.withIndex().associate { (i, k) -> k to "018f3a6e-0000-7000-8000-${(i + 1).toString().padStart(12, '0')}" }
        var n = 0
        fun aplicar(quien: String, tipo: String, entidad: String, id: String, payload: JsonObject) {
            n++
            val op = Operacion("018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", tipo, entidad, id, Reloj.formatear(Hlc(HOY_MS - 100_000 + n, 0, dispositivos.getValue(quien))), payload, 1)
            assertEquals("$tipo $id $payload", Resultado.Aceptada(n.toLong()), ingesta.procesar(op))
            almacen.fijarAutor(op.opId, texto(claves.getValue(quien).jsonObject["member_id"])!!)
        }
        aplicar("papa", "trip.create", "trip", VIAJE, v["viaje"]!!.jsonObject)
        val papa = claves["papa"]!!.jsonObject
        aplicar("papa", "member.join", "member", texto(papa["member_id"])!!, JsonObject(papa.filterKeys { it in setOf("apodo", "emoji", "color") } + ("es_organizador" to JsonPrimitive(1))))
        for (o in v["ops"]!!.jsonArray.map { it.jsonObject }) {
            val id = texto(o["entity_id"])!!.let { if (it == "\$viaje") VIAJE else it }
            aplicar(texto(o["integrante"])!!, texto(o["type"])!!, texto(o["entity_type"])!!, id, o["payload"]!!.jsonObject)
        }
        return Cargado(almacen, v)
    }
}
