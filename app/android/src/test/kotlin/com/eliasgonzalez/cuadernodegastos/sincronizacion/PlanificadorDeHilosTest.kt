package com.eliasgonzalez.cuadernodegastos.sincronizacion

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class PlanificadorDeHilosTest {
    private val p = PlanificadorDeHilos("prueba")

    @After
    fun cerrar() = p.close()

    @Test
    fun loProgramadoCorreEnElHiloDelCoordinadorYEnOrden() {
        val vistos = LinkedBlockingQueue<String>()
        p.despues(100) { vistos += "b " + Thread.currentThread().name }
        p.despues(0) { vistos += "a " + Thread.currentThread().name }
        assertEquals("a prueba-coordinador", vistos.poll(2, TimeUnit.SECONDS))
        assertEquals("b prueba-coordinador", vistos.poll(2, TimeUnit.SECONDS))
    }

    @Test
    fun cerradoNoLanzaNiCorre() {
        p.close()
        p.despues(0) { error("no debía correr") }.cancelar()
        p.aparte({ error("no debía correr") }) { }
    }

    @Test
    fun loCanceladoNoCorre() {
        val corrio = CountDownLatch(1)
        p.despues(200) { corrio.countDown() }.cancelar()
        assertFalse(corrio.await(500, TimeUnit.MILLISECONDS))
    }

    @Test
    fun elTrabajoCorreAparteYElResultadoVuelveAlCoordinador() {
        val vistos = LinkedBlockingQueue<String>()
        p.aparte({ Thread.currentThread().name }) { vistos += "$it -> " + Thread.currentThread().name }
        assertEquals("prueba-ciclo -> prueba-coordinador", vistos.poll(2, TimeUnit.SECONDS))
    }

    @Test
    fun unTrabajoLargoNoTrabaAlCoordinador() {
        val soltar = CountDownLatch(1)
        val listo = CountDownLatch(1)
        p.aparte({ soltar.await(5, TimeUnit.SECONDS) }) { }
        p.despues(0) { listo.countDown() }
        assertTrue(listo.await(2, TimeUnit.SECONDS))
        soltar.countDown()
    }
}
