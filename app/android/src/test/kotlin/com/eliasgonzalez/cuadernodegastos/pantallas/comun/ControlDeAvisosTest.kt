package com.eliasgonzalez.cuadernodegastos.pantallas.comun

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ControlDeAvisosTest {
    private val hilo = StandardTestDispatcher()
    private val alcance = TestScope(hilo)

    @Test
    fun venceYUnoNuevoReemplazaAlAnteriorConSuPropioTiempo() {
        val c = ControlDeAvisos(alcance, hilo, 4_000, { null }, { null })
        c.mostrar(AvisoDeGastos.Guardado("a", "₲ 1"))
        alcance.advanceTimeBy(3_000)
        c.mostrar(AvisoDeGastos.EnPapelera("b", "₲ 2"))
        alcance.advanceTimeBy(3_000)
        alcance.runCurrent()
        // el primero no lo borra: el nuevo tiene sus 4 s
        assertEquals(AvisoDeGastos.EnPapelera("b", "₲ 2"), c.aviso.value)
        alcance.advanceTimeBy(1_001)
        alcance.runCurrent()
        assertNull(c.aviso.value)
    }

    @Test
    fun deshacerSinAvisoConDeshacerNoHaceNadaYUnaFallaSeAvisa() {
        var llamadas = 0
        val c = ControlDeAvisos(alcance, hilo, 4_000, { llamadas++; error("base") }, { null })
        c.mostrar(AvisoDeGastos.Deshecho("₲ 1"))
        c.alDeshacer()
        assertEquals(0, llamadas)
        c.mostrar(AvisoDeGastos.Guardado("a", "₲ 1"))
        c.alDeshacer()
        alcance.runCurrent()
        assertEquals(1, llamadas)
        assertEquals(AvisoDeGastos.NoSePudoDeshacer, c.aviso.value)
    }

    @Test
    fun elAvisoDeLaAppDeshaceYRestauraEnElViajeDeCadaAviso() {
        Dispatchers.setMain(hilo)
        try {
            val hechas = mutableListOf<String>()
            val avisos = AvisosViewModel({ v, g -> hechas += "alta $v $g"; Resultado.Aceptada(1) }, { v, g -> hechas += "papelera $v $g"; null }, hilo = hilo)
            avisos.mostrar("v1", AvisoDeGastos.Guardado("a", "₲ 1"))
            avisos.alDeshacer()
            hilo.scheduler.runCurrent()
            assertEquals(AvisoDeGastos.Deshecho("₲ 1"), avisos.aviso.value)
            avisos.mostrar("v2", AvisoDeGastos.EnPapelera("b", "₲ 2"))
            avisos.alDeshacer()
            hilo.scheduler.runCurrent()
            assertEquals(AvisoDeGastos.NoSePudoRestaurar, avisos.aviso.value)
            assertEquals(listOf("alta v1 a", "papelera v2 b"), hechas)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun elResultadoDeUnDeshacerNoTapaUnAvisoMasNuevo() {
        var deshechos = 0
        val c = ControlDeAvisos(alcance, hilo, 4_000, { deshechos++; Resultado.Aceptada(1) }, { null })
        c.mostrar(AvisoDeGastos.Guardado("a", "₲ 1"))
        c.alDeshacer()
        // antes de que termine, otro gasto va a la papelera
        c.mostrar(AvisoDeGastos.EnPapelera("b", "₲ 2"))
        alcance.runCurrent()
        assertEquals(1, deshechos)
        assertEquals(AvisoDeGastos.EnPapelera("b", "₲ 2"), c.aviso.value)
    }

    @Test
    fun unDeshacerQueFallaSeAvisaAunqueHayaUnAvisoMasNuevo() {
        // decidido: un fallo nunca se pierde (aunque tape el aviso más nuevo y su deshacer)
        val c = ControlDeAvisos(alcance, hilo, 4_000, { null }, { null })
        c.mostrar(AvisoDeGastos.EnPapelera("a", "₲ 1"))
        c.alDeshacer()
        c.mostrar(AvisoDeGastos.Guardado("b", "₲ 2"))
        alcance.runCurrent()
        assertEquals(AvisoDeGastos.NoSePudoRestaurar, c.aviso.value)
    }

    @Test
    fun deshacerDosVecesMandaUnaSolaVezYDuplicadaCuentaComoExito() {
        var deshechos = 0
        val c = ControlDeAvisos(alcance, hilo, 4_000, { deshechos++; Resultado.Duplicada }, { Resultado.Aceptada(2) })
        c.mostrar(AvisoDeGastos.Guardado("a", "₲ 1"))
        // el botón sigue visible mientras el aviso se desvanece: un segundo toque no manda nada
        c.alDeshacer()
        c.alDeshacer()
        alcance.runCurrent()
        assertEquals(1, deshechos)
        assertEquals(AvisoDeGastos.Deshecho("₲ 1"), c.aviso.value)
        c.mostrar(AvisoDeGastos.EnPapelera("b", "₲ 2"))
        c.alDeshacer()
        alcance.runCurrent()
        assertEquals(AvisoDeGastos.Restaurado("₲ 2"), c.aviso.value)
    }
}
