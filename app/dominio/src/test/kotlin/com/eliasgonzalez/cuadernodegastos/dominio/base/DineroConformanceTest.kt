package com.eliasgonzalez.cuadernodegastos.dominio.base

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los mismos vectores que pasa el servidor: los cuatro celulares y el servicio calculan lo mismo. */
class DineroConformanceTest {
    private val v = Vectores.leer("dinero.json")
    private val monedas: Map<String, Moneda> =
        v["monedas"]!!.jsonObject.mapValues { (codigo, m) ->
            Moneda(codigo, m.jsonObject["decimales"]!!.jsonPrimitive.int, m.jsonObject["simbolo"]!!.jsonPrimitive.content)
        }

    private fun casos(nombre: String) = v[nombre]!!.jsonArray.map { it.jsonObject }

    @Test
    fun elMaximoEsElMismoQueElDelServidor() {
        assertEquals(v["maxMontoMinor"]!!.jsonPrimitive.long, Dinero.MAX_MONTO_MINOR)
    }

    @Test
    fun formatear() {
        val c = casos("formatear")
        assertTrue(c.size >= 10)
        for (caso in c) {
            val moneda = monedas.getValue(caso["moneda"]!!.jsonPrimitive.content)
            assertEquals(caso.toString(), caso["esperado"]!!.jsonPrimitive.content, Dinero.formatear(caso["minor"]!!.jsonPrimitive.long, moneda))
        }
    }

    @Test
    fun formatearNumero() {
        val c = casos("formatearNumero")
        assertTrue(c.size >= 5)
        for (caso in c) {
            assertEquals(caso.toString(), caso["esperado"]!!.jsonPrimitive.content, Dinero.formatearNumero(caso["minor"]!!.jsonPrimitive.long, caso["decimales"]!!.jsonPrimitive.int))
        }
    }

    @Test
    fun parsear() {
        val c = casos("parsear")
        assertTrue(c.size >= 10)
        for (caso in c) {
            val moneda = monedas.getValue(caso["moneda"]!!.jsonPrimitive.content)
            val esperado =
                caso["esperado"]?.let { ResultadoParseo.Ok(it.jsonPrimitive.long) }
                    ?: ResultadoParseo.Error(ErrorMonto.entries.single { it.codigo == caso["error"]!!.jsonPrimitive.content })
            assertEquals(caso.toString(), esperado, Dinero.parsear(caso["texto"]!!.jsonPrimitive.content, moneda))
        }
    }

    @Test
    fun formatearEntrada() {
        val c = casos("formatearEntrada")
        assertTrue(c.size >= 10)
        for (caso in c) {
            val moneda = monedas.getValue(caso["moneda"]!!.jsonPrimitive.content)
            assertEquals(caso.toString(), caso["esperado"]!!.jsonPrimitive.content, Dinero.formatearEntrada(caso["crudo"]!!.jsonPrimitive.content, moneda))
        }
    }

    @Test
    fun dividirHaciaAbajo() {
        val c = casos("dividirHaciaAbajo")
        assertTrue(c.size >= 5)
        var salteados = 0
        for (caso in c) {
            val a = caso["a"]!!.jsonPrimitive.longOrNull
            val b = caso["b"]!!.jsonPrimitive.longOrNull
            if (caso["error"]?.jsonPrimitive?.boolean == true) {
                if (a != null && b != null) {
                    assertThrows(caso.toString(), IllegalArgumentException::class.java) { Dinero.dividirHaciaAbajo(a, b) }
                } else {
                    // solo se saltea un número con decimales de verdad (no entra en un Long: el tipo ya lo rechaza)
                    val noEntero = listOf(caso["a"]!!, caso["b"]!!).map { it.jsonPrimitive.content }.filter { it.toLongOrNull() == null }
                    assertTrue(caso.toString(), noEntero.all { it.toDouble() % 1.0 != 0.0 })
                    salteados++
                }
            } else {
                assertEquals(caso.toString(), caso["esperado"]!!.jsonPrimitive.long, Dinero.dividirHaciaAbajo(a!!, b!!))
            }
        }
        // hoy son dos (10/1.5 y 1.5/2): si aparece otro, hay que mirarlo
        assertEquals(2, salteados)
    }
}
