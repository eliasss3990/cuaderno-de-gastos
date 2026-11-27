package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HoyViewModelTest {
    private val hilo = UnconfinedTestDispatcher()

    @Before
    fun antes() = Dispatchers.setMain(hilo)

    @After
    fun despues() = Dispatchers.resetMain()

    @Test
    fun cadaAvisoDeCambioVuelveALeerYUnErrorDeLaBaseNoTiraLaApp() = runTest(hilo) {
        var lecturas = 0
        var falla = true
        val cambios = MutableStateFlow(0L)
        val vm = HoyViewModel({ lecturas++; if (falla) error("base bloqueada") else null }, { 0 }, cambios, flowOf(null), hilo, reloj = flowOf(Unit))
        val junta = launch { vm.estado.collect {} }
        // falló: queda como cargando, sin romper
        assertEquals(HoyEstado(), vm.estado.value)
        falla = false
        cambios.value = 1
        assertEquals(2, lecturas)
        junta.cancel()
    }

    @Test
    fun elAvisoDeGuardadoSeVaSoloYDeshacerDiceSiSePudo() = runTest(hilo) {
        val quitados = mutableListOf<String>()
        var respuesta: com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado? = com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado.Aceptada(3)
        val vm = HoyViewModel({ null }, { 0 }, MutableStateFlow(0L), flowOf(null), hilo, { id -> quitados += id; respuesta }, reloj = flowOf(Unit))
        vm.alGuardarGasto("g1", "₲ 5")
        assertEquals(AvisoDeHoy.Guardado("g1", "₲ 5"), vm.aviso.value)
        vm.alDeshacer()
        assertEquals(listOf("g1"), quitados)
        assertEquals(AvisoDeHoy.Deshecho("₲ 5"), vm.aviso.value)
        // ya deshecho: otro toque no manda nada
        vm.alDeshacer()
        assertEquals(1, quitados.size)
        testScheduler.advanceTimeBy(HoyViewModel.DURACION_DEL_AVISO + 1)
        assertEquals(null, vm.aviso.value)
        respuesta = null
        vm.alGuardarGasto("g2", "₲ 7")
        vm.alDeshacer()
        assertEquals(AvisoDeHoy.NoSePudoDeshacer, vm.aviso.value)
    }
}
