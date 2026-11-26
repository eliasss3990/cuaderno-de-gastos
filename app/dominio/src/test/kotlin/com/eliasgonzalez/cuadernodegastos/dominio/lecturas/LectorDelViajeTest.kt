package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.ayudas.ViajeDeEjemplo
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** El lector sobre el viaje de ejemplo: lo que ve cada pantalla de referencia. */
class LectorDelViajeTest {
    private val ej = ViajeDeEjemplo.cargar()
    private val lector = LectorDelViaje(ej.almacen)
    private val esperado = ej.vectores["esperado"]!!.jsonObject

    @Test
    fun elViajeYSusMonedasConElPlan() {
        val v = lector.viaje()!!
        assertEquals(ViajeDeEjemplo.VIAJE, v.id)
        assertEquals("Brasil 2027 🌴", v.nombre)
        assertEquals("America/Asuncion", v.zonaHoraria)
        assertEquals("2027-02-15" to "2027-02-28", v.fechaInicio to v.fechaFin)
        assertNull(v.estadoManual)
        val m = lector.monedas().associateBy { it.moneda.codigo }
        assertEquals(Moneda("PYG", 0, "₲"), m.getValue("PYG").moneda)
        assertEquals(Moneda("BRL", 2, "R$"), m.getValue("BRL").moneda)
        assertEquals(10_000_000L to 560_000L, m.getValue("PYG").topeMinor to m.getValue("BRL").topeMinor)
        assertTrue(m.values.all { it.habilitada })
    }

    @Test
    fun integrantesYCategorias() {
        assertEquals(listOf("Lu", "Mamá", "Nico", "Papá"), lector.integrantes().map { it.apodo })
        val papa = lector.integrantes().single { it.apodo == "Papá" }
        assertEquals(Integrante(ej.integrantes.getValue("papa"), "Papá", "#FFE2B8", "🦁", true), papa)
        assertFalse(lector.integrantes().single { it.apodo == "Lu" }.esOrganizador)
        val cats = lector.categorias()
        assertEquals(7, cats.size)
        assertEquals(Categoria("otro", "Otro", "#EEE8D8", "📦", false), cats.single { it.id == "otro" })
    }

    @Test
    fun losGastosDanLosTotalesDeLasPantallasYSabenQuienLosCargo() {
        val gastos = lector.gastos()
        val vivos = gastos.filter { !it.eliminado }
        assertEquals(esperado["papelera"]!!.jsonPrimitive.long.toInt(), gastos.size - vivos.size)
        val delViaje = vivos.filter { it.diaImputado >= "2027-02-15" }
        fun por(m: String, l: List<Gasto>) = l.filter { it.moneda == m }.sumOf { it.montoMinor }
        assertEquals(esperado["dia_a_dia"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }, mapOf("PYG" to por("PYG", delViaje), "BRL" to por("BRL", delViaje)))
        // por integrante (en reales): sale del autor de cada gasto
        val clave = ej.integrantes.entries.associate { (k, id) -> id to k }
        assertEquals(
            esperado["por_integrante_brl"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long },
            delViaje.filter { it.moneda == "BRL" }.groupBy { clave.getValue(it.autor!!) }.mapValues { g -> g.value.sumOf { it.montoMinor } },
        )
        // ordenados del más reciente al más viejo
        assertEquals(gastos.sortedByDescending { it.cuandoOcurrio }.map { it.cuandoOcurrio }, gastos.map { it.cuandoOcurrio })
        assertTrue(gastos.none { it.sinConfirmar })
    }

    @Test
    fun unGastoConCambiosSinConfirmarSeMarca() {
        val g = lector.gastos().first()
        val op = ej.almacen.opsDeEntidad("expense", g.id).last().op.opId
        ej.almacen.transaccion { ej.almacen.fijarEstado(op, EstadoOp.PENDIENTE) }
        assertEquals(listOf(g.id), lector.gastos().filter { it.sinConfirmar }.map { it.id })
    }

    @Test
    fun losGastosFijosConSuTotalYSiEstanPagados() {
        val fijos = lector.gastosFijos()
        assertEquals(3, fijos.size)
        assertEquals(
            esperado["fijos"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long },
            listOf("PYG", "BRL").associateWith { m -> fijos.filter { it.moneda == m }.sumOf { it.totalMinor } },
        )
        assertEquals(
            esperado["fijos_pagados"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long },
            listOf("PYG", "BRL").associateWith { m -> fijos.filter { it.moneda == m && it.pagadoEn != null }.sumOf { it.totalMinor } },
        )
    }

    @Test
    fun unAlmacenVacioOConDatosIncompletosNoRompe() {
        val vacio = LectorDelViaje(AlmacenMemoria())
        assertNull(vacio.viaje())
        assertEquals(emptyList<Gasto>(), vacio.gastos())
        // un gasto sin monto (no debería pasar: la validación lo filtra) se saltea en vez de romper la pantalla
        val a = AlmacenMemoria()
        a.crearEntidad("expense", "e1")
        a.escribirCampo("expense", "e1", "moneda", JsonPrimitive("PYG"), marca)
        assertEquals(emptyList<Gasto>(), LectorDelViaje(a).gastos())
        // un número donde va un texto, o al revés, cuenta como ausente
        a.crearEntidad("member", "m1")
        a.escribirCampo("member", "m1", "apodo", JsonPrimitive(5), marca)
        assertEquals(emptyList<Integrante>(), LectorDelViaje(a).integrantes())
        // un monto escrito como texto tampoco vale
        a.crearEntidad("expense", "e2")
        for ((k, v) in mapOf("monto_minor" to JsonPrimitive("1500"), "moneda" to JsonPrimitive("PYG"), "categoria_id" to JsonPrimitive("otro"), "cuando_ocurrio" to JsonPrimitive(1L), "dia_imputado" to JsonPrimitive("2027-02-18"))) {
            a.escribirCampo("expense", "e2", k, v, marca)
        }
        assertEquals(emptyList<Gasto>(), LectorDelViaje(a).gastos())
    }

    private val marca = "0000000000064-0000-018f3a6e-0000-7000-8000-00000000000a"

    @Test
    fun unEnteroEscritoComoDecimalSeLeeComoLaValidacionLoAcepta() {
        val a = AlmacenMemoria()
        a.crearEntidad("expense", "e1")
        for ((k, v) in mapOf("monto_minor" to JsonPrimitive(1500.0), "moneda" to JsonPrimitive("PYG"), "categoria_id" to JsonPrimitive("otro"), "cuando_ocurrio" to JsonPrimitive(1.0), "dia_imputado" to JsonPrimitive("2027-02-18"), "eliminado" to JsonPrimitive(1.0))) {
            a.escribirCampo("expense", "e1", k, v, marca)
        }
        val g = LectorDelViaje(a).gastos().single()
        assertEquals(1500L, g.montoMinor)
        assertTrue(g.eliminado)
        // un decimal de verdad no es un entero
        a.escribirCampo("expense", "e1", "monto_minor", JsonPrimitive(1500.5), "0000000000065-0000-018f3a6e-0000-7000-8000-00000000000a")
        assertEquals(emptyList<Gasto>(), LectorDelViaje(a).gastos())
    }

    @Test
    fun aIgualNombreOrdenaPorIdYSinDistinguirAcentosNiMayusculas() {
        val a = AlmacenMemoria()
        // "árbol" y "Árbol" valen lo mismo: decide el id (c1 antes que c2), no la mayúscula
        for ((id, n) in listOf("c3" to "zeta", "c2" to "árbol", "c1" to "Árbol", "c0" to "Bote")) {
            a.crearEntidad("category", id)
            a.escribirCampo("category", id, "nombre", JsonPrimitive(n), marca)
        }
        assertEquals(listOf("c1", "c2", "c0", "c3"), LectorDelViaje(a).categorias().map { it.id })
        // muchos con el mismo nombre: siempre por id, sin importar el orden en que los devuelva el almacén
        val b = AlmacenMemoria()
        val ids = (0 until 30).map { "m%02d".format((it * 7) % 30) }
        for (id in ids) {
            b.crearEntidad("member", id)
            b.escribirCampo("member", id, "apodo", JsonPrimitive("Igual"), marca)
        }
        assertEquals(ids.sorted(), LectorDelViaje(b).integrantes().map { it.id })
    }

    @Test
    fun unGastoConUnCambioRechazadoSeMarcaEnCuarentena() {
        val g = lector.gastos().first()
        val op = ej.almacen.opsDeEntidad("expense", g.id).last().op.opId
        ej.almacen.transaccion { ej.almacen.fijarEstado(op, EstadoOp.CUARENTENA, razon = "formato") }
        val leido = lector.gastos().single { it.id == g.id }
        assertTrue(leido.enCuarentena)
        assertFalse(leido.sinConfirmar)
    }

    @Test
    fun elEstadoManualSoloPuedeSerEnCursoOCerrado() {
        fun con(estado: String): Viaje? {
            val a = AlmacenMemoria()
            a.crearEntidad("trip", "t1")
            for ((k, v) in mapOf("nombre" to "V", "zona_horaria" to "UTC", "estado_manual" to estado)) a.escribirCampo("trip", "t1", k, JsonPrimitive(v), marca)
            return LectorDelViaje(a).viaje()
        }
        assertEquals(com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoViaje.CERRADO, con("CERRADO")!!.estadoManual)
        assertNull(con("PLANIFICADO")!!.estadoManual)
        assertNull(con("OTRO")!!.estadoManual)
    }

    @Test
    fun lasMonedasEnOrdenYLaDeshabilitadaSeVe() {
        assertEquals(listOf("BRL", "PYG"), lector.monedas().map { it.moneda.codigo })
        val a = AlmacenMemoria()
        a.crearEntidad("trip_currency", "USD")
        for ((k, v) in mapOf("habilitada" to JsonPrimitive(0), "decimales" to JsonPrimitive(2), "simbolo" to JsonPrimitive("US$"))) a.escribirCampo("trip_currency", "USD", k, v, marca)
        assertFalse(LectorDelViaje(a).monedas().single().habilitada)
        // por código, sin importar el orden en que se guardaron
        for (c in listOf("USD", "ARS", "EUR", "CLP", "BRL")) {
            a.crearEntidad("trip_currency", c)
            for ((k, v) in mapOf("habilitada" to JsonPrimitive(1), "decimales" to JsonPrimitive(2), "simbolo" to JsonPrimitive(c))) a.escribirCampo("trip_currency", c, k, v, marca)
        }
        assertEquals(listOf("ARS", "BRL", "CLP", "EUR", "USD"), LectorDelViaje(a).monedas().map { it.moneda.codigo })
    }
}
