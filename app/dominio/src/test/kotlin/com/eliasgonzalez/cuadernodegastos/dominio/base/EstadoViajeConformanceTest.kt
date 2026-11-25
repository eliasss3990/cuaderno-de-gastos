package com.eliasgonzalez.cuadernodegastos.dominio.base

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los mismos vectores que pasa el servidor (calculados con zoneinfo de Python, independientes de los dos códigos). */
class EstadoViajeConformanceTest {
    private val v = Vectores.leer("estado_viaje.json")

    private fun casos(nombre: String) = v[nombre]!!.jsonArray.map { it.jsonObject }

    private fun textoONull(o: JsonObject, k: String) = o[k]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content

    @Test
    fun inicios() {
        val c = casos("inicios")
        assertTrue(c.size >= 10)
        for (caso in c) {
            val f = caso["fecha"]!!.jsonPrimitive.content
            val z = caso["zona"]!!.jsonPrimitive.content
            assertEquals(caso.toString(), caso["ms"]!!.jsonPrimitive.long, EstadoDelViaje.inicioDelDia(f, z))
        }
    }

    @Test
    fun estados() {
        val c = casos("estados")
        assertTrue(c.size >= 10)
        for (caso in c) {
            val plan = PlanDelViaje(
                textoONull(caso, "estadoManual")?.let { EstadoViaje.valueOf(it) },
                textoONull(caso, "fechaInicio"),
                textoONull(caso, "fechaFin"),
                caso["zonaHoraria"]!!.jsonPrimitive.content,
            )
            assertEquals(caso.toString(), EstadoViaje.valueOf(caso["esperado"]!!.jsonPrimitive.content), EstadoDelViaje.estado(plan, caso["ahora"]!!.jsonPrimitive.long))
        }
    }
}
