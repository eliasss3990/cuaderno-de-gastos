package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Propiedades del motor contra un oráculo independiente (el estado calculado desde el conjunto, sin el motor). */
class OperacionesPropiedadesTest {
    private val dispositivos = listOf("018f3a6e-0000-7000-8000-00000000000a", "018f3a6e-0000-7000-8000-00000000000b", "ffffffff-ffff-ffff-ffff-ffffffffffff")
    private val azar = java.util.Random(20261123)

    private fun id(prefijo: String, i: Int) = "$prefijo-0000-7000-8000-${i.toString().padStart(12, '0')}"

    private fun <T> elegir(l: List<T>) = l[azar.nextInt(l.size)]

    private fun s(v: String) = JsonPrimitive(v)

    private fun i(v: Long) = JsonPrimitive(v)

    private val crean = setOf("trip.create", "expense.create", "fixed.create", "attachment.add", "shortcut.create", "cashmove.create", "category.create", "member.join", "currency.enable")
    private val terminales = setOf("expense.purge", "fixed.delete", "shortcut.delete", "cashmove.delete")

    /** Un conjunto de operaciones al azar. Cada marca es única: el contador es distinto en cada operación. */
    private fun generar(): List<Operacion> {
        val ops = mutableListOf<Operacion>()
        var n = 0
        fun op(tipo: String, entidadTipo: String, entidadId: String, payload: Map<String, JsonElement>) {
            n++
            val hlc = Reloj.formatear(Hlc(1L + azar.nextInt(400), n, elegir(dispositivos)))
            ops += Operacion(id("00000000", n), tipo, entidadTipo, entidadId, hlc, JsonObject(payload), 1)
        }
        val gastos = (0 until 6).map { id("eeeeeeee", it) }
        for (g in gastos) {
            op("expense.create", "expense", g, mapOf("monto_minor" to i(100), "concepto" to s("c")))
            repeat(azar.nextInt(5)) {
                val r = azar.nextDouble()
                when {
                    r < 0.25 -> op("expense.update", "expense", g, mapOf("concepto" to s("c$n")))
                    r < 0.45 -> op("expense.update", "expense", g, mapOf("lugar" to s("l$n")))
                    r < 0.6 -> op("expense.update", "expense", g, mapOf("nota" to if (azar.nextDouble() < 0.3) JsonNull else s("n$n")))
                    r < 0.8 -> op("expense.delete", "expense", g, mapOf("eliminado" to i(1)))
                    else -> op("expense.restore", "expense", g, mapOf("eliminado" to i(0)))
                }
            }
            if (azar.nextDouble() < 0.25) op("expense.purge", "expense", g, emptyMap())
        }
        val fijos = (0 until 2).map { id("ffffffff", it) }
        for (f in fijos) {
            op("fixed.create", "fixed_cost", f, mapOf("nombre" to s("h"), "moneda" to s("BRL"), "monto_unitario_minor" to i(1), "cantidad" to i(2)))
            repeat(azar.nextInt(3)) { op("fixed.update", "fixed_cost", f, mapOf("pagado_en" to if (azar.nextDouble() < 0.3) JsonNull else i(n.toLong()))) }
            if (azar.nextDouble() < 0.4) op("fixed.delete", "fixed_cost", f, emptyMap())
        }
        val duenos = gastos.map { "EXPENSE" to it } + fijos.map { "FIXED_COST" to it }
        for (k in 0 until 6) {
            val (ownerTipo, ownerId) = elegir(duenos)
            val a = id("aaaaaaaa", k)
            op("attachment.add", "attachment", a, mapOf("owner_tipo" to s(ownerTipo), "owner_id" to s(ownerId), "mime" to s("image/jpeg"), "bytes" to i(10L + k), "sha256" to s("h$k"), "tiene_miniatura" to i(0)))
            if (azar.nextDouble() < 0.4) op("attachment.remove", "attachment", a, mapOf("quitado" to i(1)))
        }
        for (k in 0 until 2) {
            val atajo = id("55555555", k)
            op("shortcut.create", "shortcut", atajo, mapOf("nombre" to s("p"), "monto_minor" to i(5), "moneda" to s("BRL"), "categoria_id" to s("otro"), "orden" to i(k.toLong())))
            repeat(azar.nextInt(3)) { op("shortcut.update", "shortcut", atajo, mapOf("orden" to i(n.toLong()))) }
            if (azar.nextDouble() < 0.5) op("shortcut.delete", "shortcut", atajo, emptyMap())
            val mov = id("66666666", k)
            op("cashmove.create", "cash_movement", mov, mapOf("tipo" to s("RETIRO"), "cuando" to i(1), "monto_minor" to i(7), "moneda" to s("BRL")))
            repeat(azar.nextInt(3)) { op("cashmove.update", "cash_movement", mov, mapOf("monto_minor" to i(n.toLong()))) }
            if (azar.nextDouble() < 0.5) op("cashmove.delete", "cash_movement", mov, emptyMap())
        }
        val cat = id("cccccccc", 0)
        op("category.create", "category", cat, mapOf("nombre" to s("c"), "color" to s("#000000"), "emoji" to s("x")))
        repeat(azar.nextInt(4)) {
            if (azar.nextBoolean()) op("category.update", "category", cat, mapOf("nombre" to s("c$n")))
            else op("category.archive", "category", cat, mapOf("archivada" to i(if (azar.nextBoolean()) 1 else 0)))
        }
        val mem = id("dddddddd", 0)
        op("member.join", "member", mem, mapOf("apodo" to s("p"), "color" to s("#111111"), "emoji" to s("y"), "es_organizador" to i(1)))
        repeat(azar.nextInt(3)) { op("member.update", "member", mem, mapOf("apodo" to s("p$n"))) }
        val viaje = id("11111111", 0)
        val monedas = JsonArray(listOf(buildJsonObject { put("codigo", "PYG"); put("decimales", 0); put("simbolo", "₲") }, buildJsonObject { put("codigo", "BRL"); put("decimales", 2); put("simbolo", "R$") }))
        op("trip.create", "trip", viaje, mapOf("nombre" to s("V"), "zona_horaria" to s("America/Asuncion"), "monedas" to monedas))
        repeat(azar.nextInt(4)) {
            if (azar.nextBoolean()) op("trip.update", "trip", viaje, mapOf("estado_manual" to if (azar.nextDouble() < 0.4) JsonNull else s("CERRADO")))
            else op("trip.update", "trip", viaje, mapOf("nombre" to s("V$n")))
        }
        repeat(azar.nextInt(4)) {
            val moneda = elegir(listOf("PYG", "BRL"))
            if (azar.nextBoolean()) op("currency.update", "trip_currency", moneda, mapOf("tope_minor" to i(n.toLong())))
            else op("currency.update", "trip_currency", moneda, mapOf("efectivo_inicial_minor" to if (azar.nextDouble() < 0.3) JsonNull else i(n.toLong())))
        }
        return ops
    }

    /** Un orden de llegada válido: lo que se crea llega antes que lo que se edita; el resto, en cualquier orden. */
    private fun ordenAleatorio(ops: List<Operacion>, terminalesAntes: Boolean): List<Operacion> {
        val primero = ops.filter { it.tipo in crean && it.tipo != "attachment.add" }.shuffled(azar)
        val adjuntos = ops.filter { it.tipo == "attachment.add" }.shuffled(azar)
        if (!terminalesAntes) return primero + adjuntos + ops.filter { it.tipo !in crean }.shuffled(azar)
        val term = ops.filter { it.tipo in terminales }.shuffled(azar)
        return primero + term + adjuntos + ops.filter { it.tipo !in crean && it.tipo !in terminales }.shuffled(azar)
    }

    private fun conDuplicados(orden: List<Operacion>): List<Operacion> {
        val salida = orden.toMutableList()
        for (o in orden) {
            if (azar.nextDouble() < 0.25) {
                val desde = salida.indexOf(o) + 1
                salida.add(desde + azar.nextInt(salida.size - desde + 1), o)
            }
        }
        return salida
    }

    private data class Escritura(val tipo: String, val id: String, val campo: String, val valor: JsonElement, val hlc: String)

    /** Lo que crea y escribe cada operación, calculado sin usar el motor. */
    private fun efectos(o: Operacion): Pair<List<Pair<String, String>>, List<Escritura>> {
        val creaciones = mutableListOf<Pair<String, String>>()
        if (o.tipo in crean) creaciones += o.entidadTipo to o.entidadId
        val w = mutableListOf<Escritura>()
        fun poner(tipo: String, id: String, campo: String, valor: JsonElement) {
            w += Escritura(tipo, id, campo, valor, o.hlc)
        }
        for ((campo, valor) in o.payload) {
            if (o.tipo == "trip.create" && campo == "monedas") continue
            poner(o.entidadTipo, o.entidadId, campo, valor)
            if (o.tipo == "currency.update" && campo == "efectivo_inicial_minor") {
                poner(o.entidadTipo, o.entidadId, "efectivo_inicial_en", if (valor is JsonNull) JsonNull else i(o.hlc.take(13).toLong(16)))
            }
        }
        if (o.tipo == "trip.create") {
            creaciones += "category" to "otro"
            poner("category", "otro", "nombre", s("Otro"))
            poner("category", "otro", "emoji", s("📦"))
            poner("category", "otro", "color", s("#EEE8D8"))
            poner("category", "otro", "archivada", i(0))
            for (m in o.payload["monedas"]!!.jsonArray.map { it.jsonObject }) {
                val codigo = m["codigo"]!!.jsonPrimitive.content
                creaciones += "trip_currency" to codigo
                poner("trip_currency", codigo, "habilitada", i(1))
                poner("trip_currency", codigo, "decimales", i(m["decimales"]!!.jsonPrimitive.long))
                poner("trip_currency", codigo, "simbolo", m["simbolo"]!!)
            }
        }
        return creaciones to w
    }

    private val porClave = compareBy<Pair<String, String>>({ it.first }, { it.second })

    /** El estado que debe quedar, calculado desde el conjunto de operaciones y no desde el motor. */
    private fun oraculo(ops: List<Operacion>): JsonObject {
        val terminados = HashSet<Pair<String, String>>()
        val idsTerminados = HashSet<String>()
        for (o in ops.filter { it.tipo in terminales }) {
            terminados += o.entidadTipo to o.entidadId
            if (o.entidadTipo == "expense" || o.entidadTipo == "fixed_cost") idsTerminados += o.entidadId
        }
        val duenoDe = ops.filter { it.tipo == "attachment.add" }.associate { it.entidadId to it.payload["owner_id"]!!.jsonPrimitive.content }
        for ((adjunto, dueno) in duenoDe) if (dueno in idsTerminados) terminados += "attachment" to adjunto
        val existen = HashSet<Pair<String, String>>()
        val campos = HashMap<Pair<String, String>, MutableMap<String, Pair<JsonElement, String>>>()
        for (o in ops) {
            val (creaciones, w) = efectos(o)
            for (c in creaciones) if (c !in terminados) existen += c
            for (e in w) {
                val k = e.tipo to e.id
                if (k in terminados) continue
                val fila = campos.getOrPut(k) { HashMap() }
                val actual = fila[e.campo]
                if (actual == null || e.hlc > actual.second) fila[e.campo] = e.valor to e.hlc
            }
        }
        val entidades = existen.sortedWith(porClave).map { k ->
            val fila = campos[k].orEmpty().toSortedMap()
            JsonObject(
                mapOf(
                    "tipo" to s(k.first), "id" to s(k.second),
                    "campos" to JsonObject(fila.mapValues { it.value.first }),
                    "relojes" to JsonObject(fila.mapValues { s(it.value.second) }),
                ),
            )
        }
        val lapidas = terminados.sortedWith(porClave).map { JsonObject(mapOf("tipo" to s(it.first), "id" to s(it.second))) }
        val guardadas = ops.distinctBy { it.opId }.sortedBy { it.opId }.map { o ->
            val padreId = when {
                o.tipo == "attachment.add" -> o.payload["owner_id"]!!.jsonPrimitive.content
                o.entidadTipo == "attachment" -> duenoDe[o.entidadId]
                else -> null
            }
            val redactada = (o.entidadTipo to o.entidadId) in terminados || (padreId != null && padreId in idsTerminados)
            JsonObject(
                mapOf(
                    "opId" to s(o.opId), "tipo" to s(o.tipo), "entidadTipo" to s(o.entidadTipo), "entidadId" to s(o.entidadId), "hlc" to s(o.hlc),
                    "payload" to if (redactada) JsonNull else o.payload, "redactada" to JsonPrimitive(redactada), "padreId" to (padreId?.let { s(it) } ?: JsonNull),
                ),
            )
        }
        return JsonObject(mapOf("entidades" to JsonArray(entidades), "lapidas" to JsonArray(lapidas), "ops" to JsonArray(guardadas)))
    }

    @Test
    fun elMotorLlegaAlEstadoDelOraculoConCualquierOrdenValidoYDuplicados() {
        repeat(150) {
            val ops = generar()
            val esperado = oraculo(ops)
            for (intento in 0 until 4) {
                val orden = conDuplicados(ordenAleatorio(ops, terminalesAntes = intento % 2 == 1))
                val almacen = AlmacenMemoria()
                val motor = MotorOperaciones(almacen)
                val vistas = HashSet<String>()
                val secuencias = mutableListOf<Long>()
                for (o in orden) {
                    val r = motor.aplicar(o)
                    if (!vistas.add(o.opId)) {
                        assertEquals(Resultado.Duplicada, r)
                    } else {
                        assertTrue("$r", r is Resultado.Aceptada)
                        secuencias += (r as Resultado.Aceptada).seq
                    }
                }
                assertEquals((1L..secuencias.size).toList(), secuencias)
                assertEquals(esperado, almacen.instantanea())
            }
        }
    }

    @Test
    fun loTerminadoNoVuelveYLoRedactadoNoConservaSuPayload() {
        repeat(60) {
            val ops = generar()
            val terminadas = ops.filter { it.tipo in terminales }.map { it.entidadTipo to it.entidadId }.toSet()
            val almacen = AlmacenMemoria()
            val motor = MotorOperaciones(almacen)
            ordenAleatorio(ops, false).forEach { motor.aplicar(it) }
            val inst = almacen.instantanea()
            for (e in inst["entidades"]!!.jsonArray.map { it.jsonObject }) {
                assertTrue((e["tipo"]!!.jsonPrimitive.content to e["id"]!!.jsonPrimitive.content) !in terminadas)
            }
            val lapidas = inst["lapidas"]!!.jsonArray.map { it.jsonObject["tipo"]!!.jsonPrimitive.content to it.jsonObject["id"]!!.jsonPrimitive.content }.toSet()
            assertTrue(lapidas.containsAll(terminadas))
            val porId = ops.associateBy { it.opId }
            for (g in inst["ops"]!!.jsonArray.map { it.jsonObject }) {
                if (g["redactada"]!!.jsonPrimitive.content == "true") assertNull(g["payload"].takeUnless { it is JsonNull })
                else assertEquals(porId.getValue(g["opId"]!!.jsonPrimitive.content).payload, g["payload"])
            }
        }
    }

    @Test
    fun otraOperacionConUnaMarcaYaUsadaSeRechazaYNoCambiaNada() {
        repeat(40) {
            val ops = generar()
            val almacen = AlmacenMemoria()
            val motor = MotorOperaciones(almacen)
            ordenAleatorio(ops, false).forEach { motor.aplicar(it) }
            val antes = almacen.instantanea()
            for (k in 0 until 15) {
                val gemela = elegir(ops).copy(opId = id("ffffffff", 1000 + k))
                assertEquals(Resultado.Rechazada(Razon.FORMATO), motor.aplicar(gemela))
            }
            assertEquals(antes, almacen.instantanea())
        }
    }
}
