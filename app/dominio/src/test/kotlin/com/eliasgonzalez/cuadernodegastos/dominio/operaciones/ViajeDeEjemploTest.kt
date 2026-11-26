package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import com.eliasgonzalez.cuadernodegastos.ayudas.ViajeDeEjemplo
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * El viaje de ejemplo (las pantallas de referencia al día 4) se carga entero y da los totales que muestran las pantallas. Los totales
 * se calculan acá a mano, desde el estado: las fórmulas de la app llegan con sus pantallas y deberán dar lo mismo.
 */
class ViajeDeEjemploTest {
    private val v = Vectores.leer("viaje-de-ejemplo.json")
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"
    private val esperado = v["esperado"]!!.jsonObject

    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun cargar(): AlmacenMemoria = ViajeDeEjemplo.cargar().almacen

    private class Gasto(val campos: JsonObject, val quien: String) {
        fun t(c: String) = (campos[c] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun n(c: String) = (campos[c] as JsonPrimitive).long
    }

    @Test
    fun seCargaEnteroYDaLosTotalesDeLasPantallas() {
        val a = cargar()
        val inst = a.instantanea()
        val entidades = inst["entidades"]!!.jsonArray.map { it.jsonObject }
        fun de(tipo: String) = entidades.filter { texto(it["tipo"]) == tipo }
        val autor = v["integrantes"]!!.jsonObject.mapValues { (_, i) -> i.jsonObject }
        // quién registró cada gasto: el dispositivo de la marca de su alta
        val dispositivos = autor.keys.withIndex().associate { (i, k) -> "018f3a6e-0000-7000-8000-${(i + 1).toString().padStart(12, '0')}" to k }
        val altas = inst["ops"]!!.jsonArray.map { it.jsonObject }.filter { texto(it["tipo"]) == "expense.create" }
            .associate { texto(it["entidadId"])!! to dispositivos.getValue(texto(it["hlc"])!!.substring(19)) }
        val todos = de("expense").map { Gasto(it["campos"]!!.jsonObject, altas.getValue(texto(it["id"])!!)) }
        val vivos = todos.filter { (it.campos["eliminado"] as? JsonPrimitive)?.content != "1" }
        val delViaje = vivos.filter { it.t("dia_imputado")!! >= "2027-02-15" }
        val prep = vivos.filter { it.t("dia_imputado")!! < "2027-02-15" }
        fun suma(l: List<Gasto>, moneda: String) = l.filter { it.t("moneda") == moneda }.sumOf { it.n("monto_minor") }
        fun porMoneda(o: JsonElement) = o.jsonObject.mapValues { it.value.jsonPrimitive.long }
        fun ambas(l: List<Gasto>) = mapOf("PYG" to suma(l, "PYG"), "BRL" to suma(l, "BRL"))

        assertEquals(porMoneda(esperado["dia_a_dia"]!!), ambas(delViaje))
        assertEquals(porMoneda(esperado["preparacion"]!!), ambas(prep))
        assertEquals(esperado["por_dia"]!!.jsonObject.mapValues { porMoneda(it.value) }, delViaje.groupBy { it.t("dia_imputado")!! }.mapValues { ambas(it.value) })

        val fijos = de("fixed_cost").map { it["campos"]!!.jsonObject }
        fun totalFijo(f: JsonObject) = f["monto_unitario_minor"]!!.jsonPrimitive.long * f["cantidad"]!!.jsonPrimitive.long
        fun fijosDe(m: String, pagados: Boolean) = fijos.filter { texto(it["moneda"]) == m && (!pagados || (it["pagado_en"] != null && it["pagado_en"] !is JsonNull)) }.sumOf { totalFijo(it) }
        assertEquals(porMoneda(esperado["fijos"]!!), mapOf("PYG" to fijosDe("PYG", false), "BRL" to fijosDe("BRL", false)))
        assertEquals(porMoneda(esperado["fijos_pagados"]!!), mapOf("PYG" to fijosDe("PYG", true), "BRL" to fijosDe("BRL", true)))
        assertEquals(
            porMoneda(esperado["uso_del_tope"]!!),
            listOf("PYG", "BRL").associateWith { fijosDe(it, false) + suma(prep, it) + suma(delViaje, it) },
        )

        val nombreCat = de("category").associate { texto(it["id"])!! to texto(it["campos"]!!.jsonObject["nombre"])!! }
        assertEquals(porMoneda(esperado["por_categoria_brl"]!!), delViaje.filter { it.t("moneda") == "BRL" }.groupBy { nombreCat.getValue(it.t("categoria_id")!!) }.mapValues { g -> g.value.sumOf { it.n("monto_minor") } })
        assertEquals(porMoneda(esperado["por_integrante_brl"]!!), delViaje.filter { it.t("moneda") == "BRL" }.groupBy { it.quien }.mapValues { g -> g.value.sumOf { it.n("monto_minor") } })
        assertEquals(esperado["por_pago"]!!.jsonObject.mapValues { porMoneda(it.value) }, delViaje.groupBy { it.t("metodo_pago")!! }.mapValues { ambas(it.value) })
        assertEquals(esperado["gastos_por_categoria"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }, vivos.groupBy { nombreCat.getValue(it.t("categoria_id")!!) }.mapValues { it.value.size })

        // lugares: los gastos vivos (también la preparación) por lugar
        for ((lugar, e) in esperado["lugares"]!!.jsonObject) {
            val ahi = vivos.filter { it.t("lugar") == lugar }
            assertEquals(lugar, e.jsonObject["visitas"]!!.jsonPrimitive.int, ahi.size)
            for (m in listOf("PYG", "BRL")) e.jsonObject[m]?.let { assertEquals("$lugar $m", it.jsonPrimitive.long, suma(ahi, m)) }
        }

        // efectivo: base (ajuste manual más reciente, o el inicial) + cambios − gastos en efectivo del viaje desde la base
        // (la preparación no descuenta: el efectivo inicial es con el que se empieza el viaje)
        val monedas = de("trip_currency").associate { texto(it["id"])!! to it["campos"]!!.jsonObject }
        val movs = de("cash_movement").map { it["campos"]!!.jsonObject }
        fun efectivo(m: String): Long {
            val ajuste = movs.filter { texto(it["tipo"]) == "AJUSTE" && texto(it["moneda_ajuste"]) == m }.maxByOrNull { it["cuando"]!!.jsonPrimitive.long }
            val desde = ajuste?.get("cuando")?.jsonPrimitive?.long ?: Long.MIN_VALUE
            var saldo = ajuste?.get("saldo_ajuste_minor")?.jsonPrimitive?.long ?: monedas.getValue(m)["efectivo_inicial_minor"]!!.jsonPrimitive.long
            for (c in movs.filter { it["cuando"]!!.jsonPrimitive.long > desde }) {
                if (texto(c["moneda_entra"]) == m) saldo += c["monto_entra_minor"]!!.jsonPrimitive.long
                if (texto(c["moneda_sale"]) == m) saldo -= c["monto_sale_minor"]!!.jsonPrimitive.long
            }
            val gastado = delViaje.filter { it.t("moneda") == m && it.t("metodo_pago") == "EFECTIVO" && it.n("cuando_ocurrio") > desde }.sumOf { it.n("monto_minor") }
            return saldo - gastado
        }
        assertEquals(porMoneda(esperado["efectivo"]!!), mapOf("PYG" to efectivo("PYG"), "BRL" to efectivo("BRL")))
        assertEquals(esperado["papelera"]!!.jsonPrimitive.int, todos.size - vivos.size)
        assertEquals(esperado["atajos"]!!.jsonPrimitive.int, de("shortcut").size)
    }
}
