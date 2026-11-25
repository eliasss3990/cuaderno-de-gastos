package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los mismos vectores que pasa el servidor. */
class ValidacionConformanceTest {
    private val v = Vectores.leer("validacion.json")
    private val validas = v["validas"]!!.jsonArray.map { it.jsonObject }
    private val invalidas = v["invalidas"]!!.jsonArray.map { it.jsonObject }
    private val bases = validas.filter { it["nombre"]!!.jsonPrimitive.content.startsWith("base de ") }
        .associate { it["op"]!!.jsonObject["tipo"]!!.jsonPrimitive.content to it["op"]!!.jsonObject }

    private val SOBRE_TEXTO = listOf("opId", "tipo", "entidadTipo", "entidadId", "hlc")

    private fun textoDe(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Versión como la compara el servidor: un número JSON con valor entero (1 y 1.0 son lo mismo). */
    private fun versionDe(e: JsonElement?): Int? {
        val p = e as? JsonPrimitive ?: return null
        if (p.isString) return null
        val d = p.content.toDoubleOrNull() ?: return null
        return if (d == Math.floor(d) && d in 0.0..1_000_000.0 && !p.content.startsWith("-")) d.toInt() else null
    }

    /** La operación con tipos de Kotlin, o null si un campo del sobre no tiene el tipo que exige (el tipo ya la rechaza). */
    private fun operacion(o: JsonObject): Operacion? {
        val textos = SOBRE_TEXTO.map { textoDe(o[it]) ?: return null }
        val payload = o["payload"] as? JsonObject ?: return null
        val version = versionDe(o["schemaVersion"]) ?: return null
        return Operacion(textos[0], textos[1], textos[2], textos[3], textos[4], payload, version)
    }

    private fun armar(caso: JsonObject): JsonObject {
        val base = bases.getValue(caso["base"]!!.jsonPrimitive.content)
        val sobre = caso["sobre"]?.jsonObject.orEmpty()
        val payload = when {
            "payloadCompleto" in caso -> caso["payloadCompleto"]!!
            else -> {
                val p = base["payload"]!!.jsonObject.toMutableMap()
                caso["quitar"]?.jsonArray?.forEach { p.remove(it.jsonPrimitive.content) }
                caso["payload"]?.jsonObject?.let { p.putAll(it) }
                JsonObject(p)
            }
        }
        return JsonObject(base + sobre + ("payload" to (sobre["payload"] ?: payload)))
    }

    @Test
    fun hayUnaBasePorTipoYMuchosCasos() {
        assertEquals(26, bases.size)
        assertEquals(Validacion.TIPOS, bases.keys)
        assertTrue(validas.size > 60)
        assertTrue(invalidas.size > 1000)
    }

    @Test
    fun validas() {
        for (c in validas) {
            val op = operacion(c["op"]!!.jsonObject)
            assertTrue("no se pudo leer: ${c["nombre"]}", op != null)
            assertEquals(c["nombre"].toString(), ResultadoValidacion.Ok, Validacion.validar(op!!))
        }
    }

    @Test
    fun invalidas() {
        var porTipo = 0
        val fallas = mutableListOf<String>()
        for (c in invalidas) {
            val crudo = armar(c)
            val op = operacion(crudo)
            if (op == null) {
                porTipo++
                continue
            }
            if (Validacion.validar(op) == ResultadoValidacion.Ok) fallas += c["nombre"]!!.jsonPrimitive.content
        }
        assertEquals("aceptadas y debían rechazarse:\n${fallas.joinToString("\n")}", 0, fallas.size)
        // si cambia, mirar por qué: una lectura rota saltearía casos sin avisar
        assertEquals(265, porTipo)
        // solo las que cambian el sobre o el payload entero pueden caer por el tipo
        for (c in invalidas) {
            if (operacion(armar(c)) == null) assertTrue(c.toString(), "sobre" in c || "payloadCompleto" in c)
        }
    }
}
