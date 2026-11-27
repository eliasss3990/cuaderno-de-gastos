package com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Ingesta
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DetalleViewModelTest {
    private val hilo = UnconfinedTestDispatcher()
    private val ahora = 1_802_971_920_000L
    private val almacen = AlmacenMemoria()
    private var n = 0
    private val gasto = "018f3a6e-2000-7000-8000-0000000000e1"

    private fun aplicar(tipo: String, entidad: String, id: String, payload: String) {
        n++
        val op = Operacion("018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", tipo, entidad, id, Reloj.formatear(Hlc(ahora - 100_000 + n, 0, "018f3a6e-0000-7000-8000-000000000001")), Json.parseToJsonElement(payload).jsonObject, 1)
        assertTrue(Ingesta(almacen) { ahora }.procesar(op) is Resultado.Aceptada)
    }

    @Before
    fun antes() {
        Dispatchers.setMain(hilo)
        aplicar("trip.create", "trip", "018f3a6e-1000-7000-8000-000000000001", """{"nombre":"Brasil","zona_horaria":"America/Asuncion","fecha_inicio":"2027-02-15","fecha_fin":"2027-02-28","monedas":[{"codigo":"BRL","decimales":2,"simbolo":"R$"}]}""")
        aplicar("expense.create", "expense", gasto, """{"monto_minor":1290,"moneda":"BRL","categoria_id":"otro","cuando_ocurrio":1802969280000,"dia_imputado":"2027-02-18"}""")
    }

    @After
    fun despues() = Dispatchers.resetMain()

    @Test
    fun aLaPapeleraUnaSolaVezYSiFallaLoDice() = runTest(hilo) {
        var llamadas = 0
        var respuesta: Resultado? = null
        val vm = DetalleViewModel({ LectorDelViaje(almacen) }, gasto, MutableStateFlow(0L), { llamadas++; respuesta }, hilo = hilo)
        backgroundScope.launch { vm.estado.collect {} }
        assertEquals("R$ 12,90", vm.estado.value.monto)
        vm.alEnviarAPapelera()
        assertEquals(FalloDeDetalle.PAPELERA to null, vm.fallo.value to vm.enviado.value)
        respuesta = Resultado.Duplicada
        vm.alEnviarAPapelera()
        assertEquals(null, vm.fallo.value)
        assertEquals(gasto to "R$ 12,90", vm.enviado.value)
        // ya mandado: otro toque no manda nada
        vm.alEnviarAPapelera()
        assertEquals(2, llamadas)
    }

    @Test
    fun unGastoQueNoExisteLoDice() = runTest(hilo) {
        val vm = DetalleViewModel({ LectorDelViaje(almacen) }, "018f3a6e-2000-7000-8000-0000000000ff", MutableStateFlow(0L), { null }, hilo = hilo)
        backgroundScope.launch { vm.estado.collect {} }
        assertEquals(true, vm.estado.value.noExiste)
    }

    @Test
    fun restaurarDiceSiNoSePudo() = runTest(hilo) {
        var respuesta: Resultado? = null
        val vm = DetalleViewModel({ LectorDelViaje(almacen) }, gasto, MutableStateFlow(0L), { null }, restaurar = { respuesta }, hilo = hilo)
        vm.alRestaurar()
        assertEquals(FalloDeDetalle.RESTAURAR, vm.fallo.value)
        respuesta = Resultado.Aceptada(2)
        vm.alRestaurar()
        assertEquals(null, vm.fallo.value)
    }

    @Test
    fun mientrasSeMandaALaPapeleraNoSeVeEnLaPapeleraYRestaurarQuitaElError() = runTest(hilo) {
        val cambios = MutableStateFlow(0L)
        var restauros = 0
        var vm: DetalleViewModel? = null
        vm = DetalleViewModel({ LectorDelViaje(almacen) }, gasto, cambios, {
            aplicar("expense.delete", "expense", gasto, """{"eliminado":1}""")
            cambios.value++
            // durante el registro (antes de volver) el estado nuevo ya llegó: no se dibuja "en la papelera"
            assertEquals(false, vm!!.estado.value.enPapelera)
            Resultado.Aceptada(1)
        }, hilo = hilo)
        backgroundScope.launch { vm.estado.collect {} }
        vm.alEnviarAPapelera()
        assertEquals(false, vm.estado.value.enPapelera)
        // otro detalle del mismo gasto (ya en la papelera): un primer restaurar falla y deja el error; el segundo lo quita
        val otro = DetalleViewModel({ LectorDelViaje(almacen) }, gasto, cambios, { null }, restaurar = { if (restauros++ == 0) null else Resultado.Aceptada(2) }, hilo = hilo)
        otro.alRestaurar()
        assertEquals(FalloDeDetalle.RESTAURAR, otro.fallo.value)
        otro.alRestaurar()
        assertEquals(null, otro.fallo.value)
    }

    @Test
    fun siLaPapeleraSeGuardoYFallóDespuesSeVeQueEstaEnLaPapelera() = runTest(hilo) {
        val cambios = MutableStateFlow(0L)
        val vm = DetalleViewModel({ LectorDelViaje(almacen) }, gasto, cambios, {
            aplicar("expense.delete", "expense", gasto, """{"eliminado":1}""")
            cambios.value++
            throw java.io.IOException("aviso")
        }, hilo = hilo)
        backgroundScope.launch { vm.estado.collect {} }
        vm.alEnviarAPapelera()
        // no salió: lo real se ve (está en la papelera), aunque la emisión llegó mientras salía
        assertEquals(true, vm.estado.value.enPapelera)
    }

    @Test
    fun trasMandarloALaPapeleraSigueEnviandoHastaIrse() = runTest(hilo) {
        val vm = DetalleViewModel({ LectorDelViaje(almacen) }, gasto, MutableStateFlow(0L), { Resultado.Aceptada(1) }, hilo = hilo)
        backgroundScope.launch { vm.estado.collect {} }
        vm.alEnviarAPapelera()
        // ya salió bien: el botón no vuelve a "Enviar a la papelera" (sería un parpadeo antes de irse)
        assertEquals(true to (gasto to "R$ 12,90"), vm.enviando.value to vm.enviado.value)
    }
}
