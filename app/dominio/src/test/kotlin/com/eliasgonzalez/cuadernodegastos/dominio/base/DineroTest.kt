package com.eliasgonzalez.cuadernodegastos.dominio.base

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** Lo que los vectores no cubren: entradas inválidas para el propio módulo y bordes del rango. */
class DineroTest {
    private val brl = Moneda("BRL", 2, "R$")

    @Test
    fun decimalesFueraDeRangoEsUnErrorDelLlamador() {
        for (d in listOf(-1, 5)) {
            assertThrows(IllegalArgumentException::class.java) { Dinero.formatearNumero(1, d) }
            assertThrows(IllegalArgumentException::class.java) { Dinero.parsear("1", Moneda("X", d, "x")) }
            assertThrows(IllegalArgumentException::class.java) { Dinero.formatearEntrada("1", Moneda("X", d, "x")) }
        }
    }

    @Test
    fun montosFueraDelEnteroSeguroSonUnErrorDelLlamador() {
        assertThrows(IllegalArgumentException::class.java) { Dinero.formatear(Dinero.MAX_MONTO_MINOR + 1, brl) }
        assertThrows(IllegalArgumentException::class.java) { Dinero.formatear(-Dinero.MAX_MONTO_MINOR - 1, brl) }
        assertThrows(IllegalArgumentException::class.java) { Dinero.dividirHaciaAbajo(Long.MIN_VALUE, 2) }
        assertEquals("R$ 90.071.992.547.409,91", Dinero.formatear(Dinero.MAX_MONTO_MINOR, brl))
        assertEquals("-R$ 90.071.992.547.409,91", Dinero.formatear(-Dinero.MAX_MONTO_MINOR, brl))
    }

    @Test
    fun elDivisorDebeSerMayorQueCero() {
        for (b in listOf(0L, -3L, Dinero.MAX_MONTO_MINOR + 1)) {
            assertThrows(IllegalArgumentException::class.java) { Dinero.dividirHaciaAbajo(10, b) }
        }
        assertEquals(-4L, Dinero.dividirHaciaAbajo(-7, 2))
        assertEquals(3L, Dinero.dividirHaciaAbajo(7, 2))
    }

    @Test
    fun parsearNoAceptaSignoNiEspaciosNiPuntosMalPuestos() {
        for (t in listOf("-1", "+1", " 1", "1 ", "1.23", "12.345.67", "1,2,3", "٣", "１")) {
            assertEquals(t, ResultadoParseo.Error(ErrorMonto.FORMATO), Dinero.parsear(t, brl))
        }
    }
}
