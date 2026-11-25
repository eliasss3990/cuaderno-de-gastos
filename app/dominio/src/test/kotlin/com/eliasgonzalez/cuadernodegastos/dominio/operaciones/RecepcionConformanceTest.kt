package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los mismos escenarios de recepción de lotes que pasa el servidor (en la app la usa el simulador). */
class RecepcionConformanceTest {
    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun operacion(o: JsonObject) = Operacion(
        texto(o["opId"])!!, texto(o["tipo"])!!, texto(o["entidadTipo"])!!, texto(o["entidadId"])!!, texto(o["hlc"])!!,
        o["payload"]!!.jsonObject, o["schemaVersion"]!!.jsonPrimitive.int,
    )

    private fun describir(r: ResultadoDeOperacion): Map<String, Any> = buildMap {
        put("estado", mapOf(ResultadoDeOperacion.Estado.ACEPTADA to "accepted", ResultadoDeOperacion.Estado.DUPLICADA to "duplicate", ResultadoDeOperacion.Estado.RECHAZADA to "rejected").getValue(r.estado))
        r.seq?.let { put("seq", it) }
        r.razon?.let { put("razon", it.codigo) }
        put("hlc", r.hlc)
    }

    private fun esperado(o: JsonObject): Map<String, Any> = buildMap {
        put("estado", texto(o["estado"])!!)
        o["seq"]?.let { put("seq", it.jsonPrimitive.long) }
        o["razon"]?.let { put("razon", texto(it)!!) }
        put("hlc", texto(o["hlc"])!!)
    }

    @Test
    fun losEscenariosDanLoMismoQueEnElServidor() {
        val escenarios = Vectores.leer("recepcion.json")["escenarios"]!!.jsonArray.map { it.jsonObject }
        assertTrue(escenarios.size >= 5)
        for (esc in escenarios) {
            val nombre = texto(esc["nombre"])!!
            val ops = esc["ops"]!!.jsonArray.map { operacion(it.jsonObject) }
            val almacen = AlmacenMemoria()
            var ahora = 0L
            val recepcion = Recepcion(almacen) { ahora }
            for (lote in esc["lotes"]!!.jsonArray.map { it.jsonObject }) {
                ahora = lote["ahora"]!!.jsonPrimitive.long
                val dispositivo = texto(lote["dispositivo"]) ?: texto(esc["dispositivo"])!!
                val indices = lote["ops"]!!.jsonArray.map { it.jsonPrimitive.int }
                val obtenidos = recepcion.procesarLote(indices.map { ops[it] }, dispositivo)
                assertEquals(nombre, lote["resultados"]!!.jsonArray.map { esperado(it.jsonObject) }, obtenidos.map { describir(it) })
                assertEquals(nombre, indices.map { ops[it].opId }, obtenidos.map { it.opId })
            }
            val s = almacen.secuencias()
            assertEquals(nombre, (1L..s.size).toList(), s)
        }
    }

    @Test
    fun unLoteVacioODeMasDe100SeRechazaEntero() {
        val r = Recepcion(AlmacenMemoria()) { 1_802_000_000_000 }
        assertThrows(LoteInvalidoError::class.java) { r.procesarLote(emptyList(), "d") }
        val op = Operacion("o", "t", "e", "i", "h", JsonObject(emptyMap()), 1)
        assertThrows(LoteInvalidoError::class.java) { r.procesarLote(List(101) { op }, "d") }
        assertEquals(100, Recepcion.MAX_OPERACIONES_POR_LOTE)
    }
}
