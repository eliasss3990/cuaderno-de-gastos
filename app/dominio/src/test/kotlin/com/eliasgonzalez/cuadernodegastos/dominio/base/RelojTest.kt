package com.eliasgonzalez.cuadernodegastos.dominio.base

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Propiedades que los vectores no cubren caso por caso. */
class RelojTest {
    private val d1 = "018f3a6e-0000-7000-8000-000000000001"
    private val d2 = "018f3a6e-0000-7000-8000-000000000002"

    @Test
    fun compararElTextoEsCompararLaMarca() {
        val azar = java.util.Random(7)
        repeat(2000) {
            val a = Hlc(azar.nextLong(0, 1L shl 40), azar.nextInt(0, 0x10000), if (azar.nextBoolean()) d1 else d2)
            val b = Hlc(azar.nextLong(0, 1L shl 40), azar.nextInt(0, 0x10000), if (azar.nextBoolean()) d1 else d2)
            assertEquals("$a $b", Integer.signum(Reloj.formatear(a).compareTo(Reloj.formatear(b))), Reloj.comparar(a, b))
            assertEquals(a, Reloj.parsear(Reloj.formatear(a)))
        }
    }

    @Test
    fun siguienteNuncaRetrocedeAunqueElRelojVuelvaAtras() {
        val azar = java.util.Random(11)
        var ultimo: Instante? = null
        var anterior: Hlc? = null
        repeat(5000) {
            val h = Reloj.siguiente(ultimo, azar.nextLong(1_000_000, 1_000_050), d1)
            anterior?.let { assertTrue("$it -> $h", Reloj.comparar(it, h) < 0) }
            anterior = h
            ultimo = Instante(h.ms, h.contador)
        }
    }

    @Test
    fun elContadorDesbordadoAvanzaUnMilisegundo() {
        assertEquals(Hlc(1001, 0, d1), Reloj.siguiente(Instante(1000, Reloj.MAX_CONTADOR), 500, d1))
        assertThrows(IllegalArgumentException::class.java) { Reloj.siguiente(Instante(Reloj.MAX_MS, Reloj.MAX_CONTADOR), 1, d1) }
    }

    @Test
    fun parsearNoAceptaUnSaltoDeLineaFinal() {
        assertNull(Reloj.parsear("0000000000001-0001-$d1\n"))
        assertThrows(IllegalArgumentException::class.java) { Reloj.formatear(Hlc(1, 0, "$d1\n")) }
    }

    @Test
    fun ahoraCorregidaSeAcotaAlRango() {
        assertEquals(0L, Reloj.ahoraCorregida(10, -1_000))
        assertEquals(Reloj.MAX_MS, Reloj.ahoraCorregida(Reloj.MAX_MS, 1_000))
        assertThrows(IllegalArgumentException::class.java) { Reloj.ahoraCorregida(0, Long.MAX_VALUE) }
    }
}
