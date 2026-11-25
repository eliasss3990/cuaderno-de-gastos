package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Las invariantes del modelo se cumplen siempre, con cualquier orden de llegada y duplicados. */
class IngestaPropiedadesTest {
    private val azar = java.util.Random(20261123)
    private val dispositivos = listOf("018f3a6e-0000-7000-8000-00000000000a", "018f3a6e-0000-7000-8000-00000000000b")
    private val monedas = listOf("PYG", "BRL", "EUR", "USD")
    private val t = 1700000000000L

    /** Tipo de movimiento y el dinero que le corresponde, escrito aparte del código que se prueba. */
    private val dinero = mapOf(
        "CAMBIO" to listOf("moneda_sale", "monto_sale_minor", "moneda_entra", "monto_entra_minor"),
        "RETIRO" to listOf("moneda_entra", "monto_entra_minor"),
        "AJUSTE" to listOf("moneda_ajuste", "saldo_ajuste_minor"),
    )

    private fun <T> elegir(l: List<T>) = l[azar.nextInt(l.size)]

    private fun uid(tipo: String, i: Int) = "018f3a6e-$tipo-7000-8000-${i.toString().padStart(12, '0')}"

    private fun s(v: String) = JsonPrimitive(v)

    private fun i(v: Long) = JsonPrimitive(v)

    /** Operaciones de formato válido con referencias a monedas y categorías que a veces no existen. */
    private fun generar(): List<Operacion> {
        val ops = mutableListOf<Operacion>()
        var n = 0
        fun op(tipo: String, entidadTipo: String, entidadId: String, payload: Map<String, JsonElement>) {
            n++
            val hlc = Reloj.formatear(Hlc(1L + azar.nextInt(1000), n, elegir(dispositivos)))
            ops += Operacion("018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", tipo, entidadTipo, entidadId, hlc, JsonObject(payload), 1)
        }
        fun categoria() = elegir(listOf("otro", "otro", uid("7000", 1), uid("7000", 2), uid("7000", 99)))
        fun moneda() = elegir(monedas)
        val lista = JsonArray(listOf(buildJsonObject { put("codigo", "PYG"); put("decimales", 0); put("simbolo", "₲") }, buildJsonObject { put("codigo", "BRL"); put("decimales", 2); put("simbolo", "R$") }))
        op("trip.create", "trip", uid("1000", 1), mapOf("nombre" to s("V"), "zona_horaria" to s("America/Asuncion"), "monedas" to lista))
        for (m in listOf("EUR", "USD")) {
            if (azar.nextDouble() < 0.6) op("currency.enable", "trip_currency", m, mapOf("habilitada" to i(1), "decimales" to i(2), "simbolo" to s(m)))
            if (azar.nextDouble() < 0.3) op("currency.disable", "trip_currency", m, mapOf("habilitada" to i(0)))
        }
        for (k in listOf(1, 2)) {
            if (azar.nextDouble() < 0.8) op("category.create", "category", uid("7000", k), mapOf("nombre" to s("C$k"), "color" to s("#E8E4F3"), "emoji" to s("x")))
            if (azar.nextDouble() < 0.3) op("category.archive", "category", uid("7000", k), mapOf("archivada" to i(1)))
        }
        val gastos = (0 until 6).map { uid("2000", it) }
        for (g in gastos) {
            op("expense.create", "expense", g, mapOf("monto_minor" to i(100), "moneda" to s(moneda()), "categoria_id" to s(categoria()), "cuando_ocurrio" to i(t), "dia_imputado" to s("2027-02-18")))
            repeat(azar.nextInt(3)) {
                val r = azar.nextDouble()
                when {
                    r < 0.4 -> op("expense.update", "expense", g, mapOf("moneda" to s(moneda())))
                    r < 0.8 -> op("expense.update", "expense", g, mapOf("categoria_id" to s(categoria())))
                    else -> op("expense.update", "expense", g, mapOf("concepto" to s("c$n")))
                }
            }
            if (azar.nextDouble() < 0.15) op("expense.purge", "expense", g, emptyMap())
        }
        val fijos = listOf(uid("3000", 1), uid("3000", 2))
        for (f in fijos) {
            op("fixed.create", "fixed_cost", f, mapOf("nombre" to s("H"), "moneda" to s(moneda()), "monto_unitario_minor" to i(1), "cantidad" to i(1)))
            if (azar.nextDouble() < 0.5) op("fixed.update", "fixed_cost", f, mapOf("moneda" to s(moneda())))
        }
        val duenos = gastos.map { "EXPENSE" to it } + fijos.map { "FIXED_COST" to it }
        for (k in 0 until 14) {
            val (ot, oid) = elegir(duenos)
            val a = "aaaaaaaa-0000-4000-8000-${k.toString().padStart(12, '0')}"
            op("attachment.add", "attachment", a, mapOf("owner_tipo" to s(ot), "owner_id" to s(oid), "mime" to s("image/png"), "bytes" to i(5), "sha256" to s("ab".repeat(32)), "tiene_miniatura" to i(0)))
            if (azar.nextDouble() < 0.35) op("attachment.remove", "attachment", a, mapOf("quitado" to i(1)))
        }
        for (k in 0 until 12) {
            val atajo = uid("4000", k)
            op("shortcut.create", "shortcut", atajo, mapOf("nombre" to s("A$k"), "monto_minor" to i(5), "moneda" to s(moneda()), "categoria_id" to s(categoria()), "orden" to i(k.toLong())))
            if (azar.nextDouble() < 0.3) op("shortcut.update", "shortcut", atajo, mapOf("categoria_id" to s(categoria())))
            if (azar.nextDouble() < 0.3) op("shortcut.delete", "shortcut", atajo, emptyMap())
        }
        for (k in 0 until 4) {
            val m = uid("5000", k)
            val tipo = elegir(listOf("CAMBIO", "CAMBIO", "RETIRO", "AJUSTE"))
            val cuerpo = when (tipo) {
                "CAMBIO" -> mapOf("tipo" to s(tipo), "cuando" to i(t), "moneda_sale" to s("PYG"), "monto_sale_minor" to i(5), "moneda_entra" to s("BRL"), "monto_entra_minor" to i(5))
                "RETIRO" -> mapOf("tipo" to s(tipo), "cuando" to i(t), "moneda_entra" to s(moneda()), "monto_entra_minor" to i(5))
                else -> mapOf("tipo" to s(tipo), "cuando" to i(t), "moneda_ajuste" to s(moneda()), "saldo_ajuste_minor" to i(5))
            }
            op("cashmove.create", "cash_movement", m, cuerpo)
            repeat(azar.nextInt(8)) {
                val campo = elegir(listOf("moneda_sale", "moneda_entra", "moneda_ajuste", "monto_entra_minor", "saldo_ajuste_minor", "nota"))
                val cambios = mutableMapOf<String, JsonElement>(
                    campo to when {
                        campo.startsWith("moneda_") -> s(moneda())
                        campo == "nota" -> s("x")
                        else -> i(7)
                    },
                )
                if (campo == "moneda_sale" && azar.nextBoolean()) cambios["moneda_entra"] = s(moneda()) // a veces las dos a la vez
                op("cashmove.update", "cash_movement", m, cambios)
            }
        }
        return ops
    }

    private fun conDuplicados(orden: List<Operacion>): List<Operacion> {
        val salida = orden.toMutableList()
        for (o in orden) {
            if (azar.nextDouble() < 0.2) {
                val desde = salida.indexOf(o) + 1
                salida.add(desde + azar.nextInt(salida.size - desde + 1), o)
            }
        }
        return salida
    }

    @Test
    fun trasCualquierOrdenLasReferenciasExistenYSeRespetanLimitesYMovimientos() {
        val posibles = setOf(Razon.FORMATO, Razon.ENTIDAD_INEXISTENTE, Razon.MONEDA_NO_HABILITADA, Razon.LIMITE_SUPERADO)
        var rechazosPorLimite = 0
        for (caso in 0 until 200) {
            val ops = generar()
            val orden = conDuplicados(if (caso % 2 == 0) listOf(ops[0]) + ops.drop(1).shuffled(azar) else ops.shuffled(azar))
            val almacen = AlmacenMemoria()
            val ingesta = Ingesta(almacen)
            val vistas = HashSet<String>()
            var aceptadas = 0
            for (o in orden) {
                val r = ingesta.procesar(o)
                if (o.opId in vistas) assertEquals(Resultado.Duplicada, r)
                if (r is Resultado.Aceptada) aceptadas++
                if (r is Resultado.Rechazada) {
                    assertTrue("${r.razon}", r.razon in posibles)
                    if (r.razon == Razon.LIMITE_SUPERADO) rechazosPorLimite++
                } else {
                    vistas += o.opId
                }
            }
            assertEquals((1L..aceptadas).toList(), almacen.secuencias())

            val entidades = almacen.instantanea()["entidades"]!!.jsonArray.map { it.jsonObject }
            fun de(tipo: String) = entidades.filter { it["tipo"]!!.jsonPrimitive.content == tipo }
            fun campos(e: JsonObject) = e["campos"]!!.jsonObject
            fun texto(e: JsonObject, c: String) = campos(e)[c]?.jsonPrimitive?.content
            val enViaje = de("trip_currency").map { it["id"]!!.jsonPrimitive.content }.toSet()
            val categorias = de("category").map { it["id"]!!.jsonPrimitive.content }.toSet()
            for (e in de("expense") + de("fixed_cost") + de("shortcut")) texto(e, "moneda")?.let { assertTrue("moneda $it", it in enViaje) }
            for (e in de("expense") + de("shortcut")) texto(e, "categoria_id")?.let { assertTrue("categoría $it", it in categorias) }
            assertTrue(de("shortcut").size <= 6)
            val activos = de("attachment").filter { texto(it, "quitado") != "1" }.groupingBy { texto(it, "owner_id") }.eachCount()
            for ((dueno, cantidad) in activos) assertTrue("adjuntos activos de $dueno: $cantidad", cantidad <= 3)
            for (m in de("cash_movement")) {
                val tipo = texto(m, "tipo")!!
                for (c in listOf("moneda_sale", "moneda_entra", "moneda_ajuste")) texto(m, c)?.let { assertTrue(it in enViaje) }
                for (c in campos(m).keys) if (c !in listOf("tipo", "cuando", "nota")) assertTrue("campo $c en un $tipo", c in dinero.getValue(tipo))
                if (tipo == "CAMBIO") assertNotEquals("un cambio con las dos monedas iguales", texto(m, "moneda_sale"), texto(m, "moneda_entra"))
            }
        }
        assertTrue("se probaron los límites: $rechazosPorLimite", rechazosPorLimite > 0)
    }
}
