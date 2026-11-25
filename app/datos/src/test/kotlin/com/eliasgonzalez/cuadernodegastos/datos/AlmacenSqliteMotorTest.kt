package com.eliasgonzalez.cuadernodegastos.datos

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Ingesta
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** El motor y la ingesta dan lo mismo sobre SQLite que en memoria: los escenarios de conformidad y historias al azar. */
class AlmacenSqliteMotorTest {
    private val dir = File(System.getProperty("conformance.dir"))

    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun operacion(o: JsonObject): Operacion? = Operacion(
        texto(o["opId"]) ?: return null, texto(o["tipo"]) ?: return null, texto(o["entidadTipo"]) ?: return null,
        texto(o["entidadId"]) ?: return null, texto(o["hlc"]) ?: return null, o["payload"] as? JsonObject ?: return null,
        o["schemaVersion"]!!.jsonPrimitive.int,
    )

    private fun sqlite(): AlmacenSqlite {
        val b = BaseJdbc()
        Migraciones.aplicar(b)
        return AlmacenSqlite(b, "viaje")
    }

    private fun recorrer(archivo: String, conAhoras: Boolean): Int {
        var pasos = 0
        for (esc in Json.parseToJsonElement(File(dir, archivo).readText()).jsonObject["escenarios"]!!.jsonArray.map { it.jsonObject }) {
            val ops = esc["ops"]!!.jsonArray.map { operacion(it.jsonObject) }
            val ordenes = esc["orden"]?.let { listOf(it.jsonArray) } ?: esc["ordenes"]!!.jsonArray.map { it.jsonArray }
            val ahoras = esc["ahoras"]?.jsonArray?.map { it.jsonPrimitive.long }
            for (orden in ordenes.map { o -> o.map { it.jsonPrimitive.int } }) {
                val m = AlmacenMemoria()
                val s = sqlite()
                var ahora = 0L
                val im = Ingesta(m) { ahora }
                val isq = Ingesta(s) { ahora }
                orden.forEachIndexed { k, i ->
                    if (conAhoras) ahora = ahoras!![k]
                    val op = ops[i] ?: return@forEachIndexed
                    assertEquals("${esc["nombre"]} paso $k", im.procesar(op), isq.procesar(op))
                    pasos++
                }
                assertEquals("${esc["nombre"]}", m.instantanea(), s.instantanea())
                assertEquals("${esc["nombre"]}", m.intervalosDeCierre(), s.intervalosDeCierre())
                assertEquals("${esc["nombre"]}", m.secuencias(), s.secuencias())
            }
        }
        return pasos
    }

    @Test
    fun losEscenariosDeConformidadDanLoMismo() {
        assertTrue(recorrer("operaciones.json", false) > 50)
        assertTrue(recorrer("ingesta.json", false) > 20)
        assertTrue(recorrer("cierre.json", true) > 20)
    }

    @Test
    fun historiasAlAzarDanElMismoEstadoQueEnMemoria() {
        val azar = java.util.Random(77)
        val disp = "018f3a6e-0000-7000-8000-00000000000a"
        fun id(p: String, i: Int) = "$p-0000-7000-8000-${i.toString().padStart(12, '0')}"
        fun s(v: String) = JsonPrimitive(v)
        repeat(60) {
            var n = 0
            val ops = mutableListOf<Operacion>()
            fun op(tipo: String, et: String, eid: String, p: Map<String, JsonElement>) {
                n++
                ops += Operacion(id("00000000", n), tipo, et, eid, Reloj.formatear(Hlc(1L + azar.nextInt(500), n, disp)), JsonObject(p), 1)
            }
            op("trip.create", "trip", id("11111111", 0), mapOf("nombre" to s("V"), "zona_horaria" to s("America/Asuncion"), "monedas" to Json.parseToJsonElement("""[{"codigo":"PYG","decimales":0,"simbolo":"₲"}]""")))
            val gastos = (0 until 4).map { id("eeeeeeee", it) }
            repeat(40) {
                val g = gastos[azar.nextInt(4)]
                when (azar.nextInt(7)) {
                    0, 1 -> op("expense.create", "expense", g, mapOf("monto_minor" to JsonPrimitive(5), "moneda" to s("PYG"), "categoria_id" to s("otro"), "cuando_ocurrio" to JsonPrimitive(1), "dia_imputado" to s("2027-02-18")))
                    2 -> op("expense.update", "expense", g, mapOf("concepto" to s("c$n"), "nota" to if (azar.nextBoolean()) kotlinx.serialization.json.JsonNull else s("n")))
                    3 -> op("attachment.add", "attachment", id("aaaaaaaa", azar.nextInt(5)), mapOf("owner_tipo" to s("EXPENSE"), "owner_id" to s(g), "mime" to s("image/png"), "bytes" to JsonPrimitive(1), "sha256" to s("ab".repeat(32)), "tiene_miniatura" to JsonPrimitive(0)))
                    4 -> op("attachment.remove", "attachment", id("aaaaaaaa", azar.nextInt(5)), mapOf("quitado" to JsonPrimitive(1)))
                    5 -> op("expense.purge", "expense", g, emptyMap())
                    else -> op("trip.update", "trip", id("11111111", 0), mapOf("estado_manual" to if (azar.nextBoolean()) s("CERRADO") else kotlinx.serialization.json.JsonNull))
                }
            }
            val orden = listOf(ops[0]) + (ops.drop(1) + ops.filter { azar.nextInt(4) == 0 }).shuffled(azar)
            val m = AlmacenMemoria()
            val sq = sqlite()
            val im = Ingesta(m) { 1_000_000L }
            val isq = Ingesta(sq) { 1_000_000L }
            for (o in orden) assertEquals(im.procesar(o), isq.procesar(o))
            assertEquals(m.instantanea(), sq.instantanea())
            assertEquals(m.intervalosDeCierre(), sq.intervalosDeCierre())
        }
    }
}
