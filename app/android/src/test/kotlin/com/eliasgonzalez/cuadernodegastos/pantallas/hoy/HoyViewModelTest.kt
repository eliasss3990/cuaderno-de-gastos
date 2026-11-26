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
        val vm = HoyViewModel({ lecturas++; if (falla) error("base bloqueada") else null }, { 0 }, cambios, flowOf(null), hilo, flowOf(Unit))
        val junta = launch { vm.estado.collect {} }
        // falló: queda como cargando, sin romper
        assertEquals(HoyEstado(), vm.estado.value)
        falla = false
        cambios.value = 1
        assertEquals(2, lecturas)
        junta.cancel()
    }
}
