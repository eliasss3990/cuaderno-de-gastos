package com.eliasgonzalez.cuadernodegastos.pantallas.gastos

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Ingesta
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GastosViewModelTest {
    private val hilo = UnconfinedTestDispatcher()
    private val ahora = 1_802_971_920_000L
    private val almacen = AlmacenMemoria()
    private var n = 0

    private fun aplicar(tipo: String, entidad: String, id: String, payload: String) {
        n++
        val op = Operacion("018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", tipo, entidad, id, Reloj.formatear(Hlc(ahora - 100_000 + n, 0, "018f3a6e-0000-7000-8000-000000000001")), Json.parseToJsonElement(payload).jsonObject, 1)
        assertTrue(Ingesta(almacen) { ahora }.procesar(op) is Resultado.Aceptada)
    }

    @Before
    fun antes() {
        Dispatchers.setMain(hilo)
        aplicar("trip.create", "trip", "018f3a6e-1000-7000-8000-000000000001", """{"nombre":"Brasil","zona_horaria":"America/Asuncion","fecha_inicio":"2027-02-15","fecha_fin":"2027-02-28","monedas":[{"codigo":"BRL","decimales":2,"simbolo":"R$"}]}""")
        aplicar("expense.create", "expense", "018f3a6e-2000-7000-8000-0000000000e1", """{"monto_minor":1290,"moneda":"BRL","categoria_id":"otro","cuando_ocurrio":1802969280000,"dia_imputado":"2027-02-18"}""")
        aplicar("expense.create", "expense", "018f3a6e-2000-7000-8000-0000000000e2", """{"monto_minor":5000,"moneda":"BRL","categoria_id":"otro","cuando_ocurrio":1801000000000,"dia_imputado":"2027-01-26"}""")
    }

    @After
    fun despues() = Dispatchers.resetMain()

    @Test
    fun armaLaListaDelViajeYLaPreparacion() = runTest(hilo) {
        val vm = GastosViewModel({ LectorDelViaje(almacen) }, { 0 }, MutableStateFlow(0L), flowOf(null), hilo)
        backgroundScope.launch { vm.estado.collect {} }
        val e = vm.estado.value
        assertEquals(false, e.cargando)
        assertEquals(listOf("JUEVES 18 FEB" to "R$ 12,90"), e.delViaje.map { it.titulo to it.totales })
        assertEquals(listOf("MARTES 26 ENE" to "R$ 50,00"), e.preparacion.map { it.titulo to it.totales })
    }

    @Test
    fun siLeerFallaLoDiceSinCaerse() = runTest(hilo) {
        val vm = GastosViewModel({ error("base bloqueada") }, { 0 }, MutableStateFlow(0L), flowOf(null), hilo)
        backgroundScope.launch { vm.estado.collect {} }
        assertEquals(false to true, vm.estado.value.cargando to vm.estado.value.noSePudoLeer)
    }

    @Test
    fun sinViajeTodaviaEsperaYNoDiceError() = runTest(hilo) {
        val vm = GastosViewModel({ LectorDelViaje(AlmacenMemoria()) }, { 0 }, MutableStateFlow(0L), flowOf(null), hilo)
        backgroundScope.launch { vm.estado.collect {} }
        assertEquals(true to false, vm.estado.value.cargando to vm.estado.value.noSePudoLeer)
    }

    @Test
    fun sigueAlDiaAunqueOtraPantallaLaTape() = runTest(hilo) {
        val cambios = MutableStateFlow(0L)
        val vm = GastosViewModel({ LectorDelViaje(almacen) }, { 0 }, cambios, flowOf(null), hilo)
        val mirando = launch { vm.estado.collect {} }
        assertEquals(1, vm.estado.value.delViaje.size)
        // se abre el detalle: nadie la mira por más de 5 s, y el gasto va a la papelera
        mirando.cancel()
        testScheduler.advanceTimeBy(6_000)
        aplicar("expense.delete", "expense", "018f3a6e-2000-7000-8000-0000000000e1", """{"eliminado":1}""")
        cambios.value++
        testScheduler.runCurrent()
        // al volver ya está al día: no aparece un instante el gasto que se fue
        assertEquals(emptyList<DiaEnPantalla>(), vm.estado.value.delViaje)
    }
}
