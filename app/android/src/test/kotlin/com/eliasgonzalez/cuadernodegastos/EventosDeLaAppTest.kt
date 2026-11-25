package com.eliasgonzalez.cuadernodegastos

import androidx.lifecycle.LifecycleOwner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class EventosDeLaAppTest {
    @Test
    fun losEventosLleganEnOrdenAunqueElPrimeroTarde() {
        val vistos = Collections.synchronizedList(mutableListOf<String>())
        val listo = CountDownLatch(200)
        var primero = true
        val e = EventosDeLaApp(
            {
                // el primer uso arma la base y tarda
                if (primero) Thread.sleep(200).also { primero = false }
                vistos += "arriba"
                listo.countDown()
            },
            {
                vistos += "abajo"
                listo.countDown()
            },
        )
        val owner: LifecycleOwner = object : LifecycleOwner {
            override val lifecycle get() = error("no se usa")
        }
        repeat(100) {
            e.onStart(owner)
            e.onStop(owner)
        }
        assertTrue("no terminaron", listo.await(5, TimeUnit.SECONDS))
        assertEquals(List(100) { listOf("arriba", "abajo") }.flatten(), vistos)
    }
}
