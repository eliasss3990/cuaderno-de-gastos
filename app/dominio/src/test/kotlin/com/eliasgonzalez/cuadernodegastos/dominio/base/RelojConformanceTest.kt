package com.eliasgonzalez.cuadernodegastos.dominio.base

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Los mismos vectores que pasa el servidor. Un número que no es entero (1.5, -0, 1e300) ni entra en un Long: el tipo ya lo rechaza. */
class RelojConformanceTest {
    private val v = Vectores.leer("reloj.json")

    private fun casos(nombre: String) = v[nombre]!!.jsonArray.map { it.jsonObject }

    private fun texto(o: JsonObject, k: String) = o[k]!!.jsonPrimitive.content

    /** El número como Long, o null si no es un entero representable (lo que en Kotlin no se puede ni pasar). */
    private fun entero(e: JsonElement?): Long? = e?.jsonPrimitive?.longOrNull

    private fun hlc(o: JsonObject): Hlc? {
        val ms = entero(o["ms"]) ?: return null
        val c = entero(o["contador"]) ?: return null
        if (c !in Int.MIN_VALUE..Int.MAX_VALUE) return null
        return Hlc(ms, c.toInt(), texto(o, "dispositivo"))
    }

    private fun instante(e: JsonElement?): Instante? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        val ms = entero(o["ms"]) ?: return null
        val c = entero(o["contador"]) ?: return null
        if (c !in Int.MIN_VALUE..Int.MAX_VALUE) return null
        return Instante(ms, c.toInt())
    }

    /** Los números del caso que no entran en un Long (decimales, -0, 1e300). */
    private fun noEnteros(e: JsonElement): List<String> = when (e) {
        is JsonObject -> e.values.flatMap { noEnteros(it) }
        is JsonArray -> e.flatMap { noEnteros(it) }
        is JsonPrimitive -> if (!e.isString && e !is JsonNull && e.booleanOrNull == null && e.longOrNull == null) listOf(e.content) else emptyList()
    }

    /** Un caso de error: o el tipo ya no lo deja pasar (`representable` falso) o la función debe fallar. */
    private fun debeFallar(caso: JsonObject, representable: Boolean, llamada: () -> Unit) {
        if (!representable) {
            // solo se saltea si de verdad trae un número que en Kotlin no se puede ni pasar
            assertTrue("salteado sin un número no entero: $caso", noEnteros(caso).isNotEmpty())
            return
        }
        try {
            llamada()
            fail("debía fallar: $caso")
        } catch (_: IllegalArgumentException) {
        }
    }

    @Test
    fun constantes() {
        assertEquals(v["maxMs"]!!.jsonPrimitive.long, Reloj.MAX_MS)
        assertEquals(v["maxContador"]!!.jsonPrimitive.long, Reloj.MAX_CONTADOR.toLong())
        assertEquals(v["toleranciaFuturoMs"]!!.jsonPrimitive.long, Reloj.TOLERANCIA_FUTURO_MS)
    }

    @Test
    fun formatearYParsear() {
        for (c in casos("formatear")) assertEquals(c.toString(), texto(c, "esperado"), Reloj.formatear(hlc(c)!!))
        for (c in casos("formatearError")) debeFallar(c, hlc(c) != null) { Reloj.formatear(hlc(c)!!) }
        val parsear = casos("parsear")
        assertTrue(parsear.size >= 20)
        for (c in parsear) {
            val esperado = c["esperado"]?.jsonObject?.let { hlc(it) }
            if (esperado == null) assertNull(c.toString(), Reloj.parsear(texto(c, "texto"))) else assertEquals(c.toString(), esperado, Reloj.parsear(texto(c, "texto")))
        }
    }

    @Test
    fun comparar() {
        for (c in casos("comparar")) {
            assertEquals(c.toString(), c["esperado"]!!.jsonPrimitive.long.toInt(), Reloj.comparar(hlc(c["a"]!!.jsonObject)!!, hlc(c["b"]!!.jsonObject)!!))
        }
        for (c in casos("compararError")) {
            val a = hlc(c["a"]!!.jsonObject)
            val b = hlc(c["b"]!!.jsonObject)
            debeFallar(c, a != null && b != null) { Reloj.comparar(a!!, b!!) }
        }
    }

    @Test
    fun siguiente() {
        for (c in casos("siguiente")) {
            var ultimo = instante(c["inicio"])
            for (paso in c["pasos"]!!.jsonArray.map { it.jsonObject }) {
                val h = Reloj.siguiente(ultimo, paso["ahora"]!!.jsonPrimitive.long, texto(c, "dispositivo"))
                val esperado = instante(paso["esperado"])!!
                assertEquals("${c["nombre"]} $paso", esperado, Instante(h.ms, h.contador))
                ultimo = Instante(h.ms, h.contador)
            }
        }
        for (c in casos("siguienteError")) {
            val ahora = entero(c["ahora"])
            val inicio = c["inicio"]
            val ultimo = instante(inicio)
            val representable = ahora != null && (inicio == null || inicio is JsonNull || ultimo != null)
            debeFallar(c, representable) { Reloj.siguiente(ultimo, ahora!!, texto(c, "dispositivo")) }
        }
    }

    @Test
    fun observar() {
        for (c in casos("observar")) {
            val observado = Reloj.observar(instante(c["ultimo"]), instante(c["remota"])!!)
            assertEquals(c.toString(), instante(c["esperadoObservado"]), observado)
            val sig = Reloj.siguiente(observado, c["ahora"]!!.jsonPrimitive.long, texto(c, "dispositivo"))
            assertEquals(c.toString(), instante(c["esperadoSiguiente"]), Instante(sig.ms, sig.contador))
        }
        for (c in casos("observarError")) {
            val u = c["ultimo"]
            val ultimo = instante(u)
            val remota = instante(c["remota"])
            debeFallar(c, remota != null && (u == null || u is JsonNull || ultimo != null)) { Reloj.observar(ultimo, remota!!) }
        }
    }

    @Test
    fun corregirFuturo() {
        for (nombre in listOf("corregirFuturo", "corregirFuturoMonotono")) {
            for (c in casos(nombre)) {
                val r = Reloj.corregirFuturo(hlc(c["hlc"]!!.jsonObject)!!, c["ahoraServidor"]!!.jsonPrimitive.long, instante(c["ultimoDelDispositivo"]))
                val e = c["esperado"]!!.jsonObject
                assertEquals(c.toString(), MarcaCorregida(hlc(e)!!, e["corregida"]!!.jsonPrimitive.boolean), r)
            }
        }
        for (c in casos("corregirFuturoError")) {
            val h = hlc(c["hlc"]!!.jsonObject)
            val ahora = entero(c["ahoraServidor"])
            val u = c["ultimoDelDispositivo"]
            val ultimo = instante(u)
            debeFallar(c, h != null && ahora != null && (u == null || u is JsonNull || ultimo != null)) { Reloj.corregirFuturo(h!!, ahora!!, ultimo) }
        }
    }

    @Test
    fun desfase() {
        for (c in casos("aprenderDesfase")) assertEquals(c.toString(), c["desfase"]!!.jsonPrimitive.long, Reloj.aprenderDesfase(c["servidor"]!!.jsonPrimitive.long, c["local"]!!.jsonPrimitive.long))
        for (c in casos("aprenderDesfaseError")) {
            val s = entero(c["servidor"])
            val l = entero(c["local"])
            debeFallar(c, s != null && l != null) { Reloj.aprenderDesfase(s!!, l!!) }
        }
        for (c in casos("ahoraCorregido")) assertEquals(c.toString(), c["esperado"]!!.jsonPrimitive.long, Reloj.ahoraCorregida(c["local"]!!.jsonPrimitive.long, c["desfase"]!!.jsonPrimitive.long))
        for (c in casos("ahoraCorregidoError")) {
            val l = entero(c["local"])
            val d = entero(c["desfase"])
            debeFallar(c, l != null && d != null) { Reloj.ahoraCorregida(l!!, d!!) }
        }
    }
}
