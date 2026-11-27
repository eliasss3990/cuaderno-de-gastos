package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.ayudas.ViajeDeEjemplo
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Ingesta
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** La lista del viaje de ejemplo (empieza el 15 de febrero; tiene gastos de preparación y en la papelera). */
class ListaDeGastosTest {
    private val ej = ViajeDeEjemplo.cargar()
    private val lector = LectorDelViaje(ej.almacen)
    private val lista = ListaDeGastos.armar(lector)!!

    @Test
    fun delViajeYPreparacionSeparadosPorElInicioDelDiaMasNuevoAlMasViejo() {
        assertTrue(lista.delViaje.isNotEmpty() && lista.preparacion.isNotEmpty())
        assertTrue(lista.delViaje.all { it.dia >= "2027-02-15" })
        assertTrue(lista.preparacion.all { it.dia < "2027-02-15" })
        for (l in listOf(lista.delViaje, lista.preparacion)) assertEquals(l.map { it.dia }.sortedDescending(), l.map { it.dia })
        // en cada día, del más reciente al más viejo, y todos de ese día
        for (d in lista.delViaje + lista.preparacion) {
            assertTrue(d.gastos.all { it.gasto.diaImputado == d.dia })
            assertEquals(d.gastos.sortedByDescending { it.gasto.cuandoOcurrio }, d.gastos)
        }
    }

    @Test
    fun losTotalesDelDiaYLaPapeleraNoCuenta() {
        val todos = (lista.delViaje + lista.preparacion).flatMap { it.gastos }
        assertTrue(todos.none { it.gasto.eliminado })
        val vivos = lector.gastos().filter { !it.eliminado }
        assertEquals(vivos.size, todos.size)
        // lo del viaje suma lo mismo que el día a día de las pantallas de referencia
        val esperado = ej.vectores["esperado"]!!.jsonObject["dia_a_dia"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }
        val sumado = lista.delViaje.flatMap { it.totales.entries }.groupBy({ it.key }, { it.value }).mapValues { it.value.sum() }
        assertEquals(esperado, sumado)
        for (d in lista.delViaje) {
            assertEquals(d.gastos.groupBy { it.gasto.moneda }.mapValues { (_, g) -> g.sumOf { it.gasto.montoMinor } }, d.totales)
            assertEquals(d.totales.keys.sorted(), d.totales.keys.toList())
        }
        assertTrue(todos.all { it.categoria != null && it.autor != null })
    }

    @Test
    fun elDetalleIncluyeLoDeLaPapeleraYSinViajeNoHayLista() {
        val enPapelera = lector.gastos().first { it.eliminado }
        assertTrue(ListaDeGastos.detalle(lector, enPapelera.id)!!.gasto.eliminado)
        val uno = lector.gastos().first { !it.eliminado }
        assertEquals(uno, ListaDeGastos.detalle(lector, uno.id)!!.gasto)
        // con su categoría y quién lo cargó
        assertEquals(uno.categoriaId, ListaDeGastos.detalle(lector, uno.id)!!.categoria?.id)
        assertNull(ListaDeGastos.detalle(lector, "no-existe"))
        assertNull(ListaDeGastos.armar(LectorDelViaje(AlmacenMemoria())))
    }

    @Test
    fun sinFechaDeInicioTodoEsDelViaje() {
        val op = Operacion(
            "018f3a6e-9000-7000-8000-0000000009ff", "trip.update", "trip", ViajeDeEjemplo.VIAJE,
            Reloj.formatear(Hlc(ViajeDeEjemplo.HOY_MS + 1_000, 0, "018f3a6e-0000-7000-8000-0000000000ff")),
            JsonObject(mapOf("fecha_inicio" to JsonNull)), 1,
        )
        assertTrue(Ingesta(ej.almacen) { ViajeDeEjemplo.HOY_MS }.procesar(op) is Resultado.Aceptada)
        val l = ListaDeGastos.armar(LectorDelViaje(ej.almacen))!!
        assertTrue(l.preparacion.isEmpty())
        assertEquals(lector.gastos().count { !it.eliminado }, l.delViaje.sumOf { it.gastos.size })
    }

    @Test
    fun unGastoDelDiaDeInicioEsDelViaje() {
        val op = Operacion(
            "018f3a6e-9000-7000-8000-0000000009fe", "expense.create", "expense", "018f3a6e-2000-7000-8000-0000000009fe",
            Reloj.formatear(Hlc(ViajeDeEjemplo.HOY_MS + 1_000, 0, "018f3a6e-0000-7000-8000-0000000000ff")),
            kotlinx.serialization.json.Json.parseToJsonElement("""{"monto_minor":1,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-15"}""").jsonObject, 1,
        )
        assertTrue(Ingesta(ej.almacen) { ViajeDeEjemplo.HOY_MS }.procesar(op) is Resultado.Aceptada)
        val l = ListaDeGastos.armar(LectorDelViaje(ej.almacen))!!
        assertTrue(l.delViaje.single { it.dia == "2027-02-15" }.gastos.any { it.gasto.id == "018f3a6e-2000-7000-8000-0000000009fe" })
        assertTrue(l.preparacion.none { it.dia == "2027-02-15" })
    }
}
