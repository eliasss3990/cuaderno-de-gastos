package com.eliasgonzalez.cuadernodegastos.dominio.base

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class EstadoViajeTest {
    private val zona = "America/Asuncion"

    @Test
    fun diaSiguienteCruzaMesesAniosYBisiestos() {
        assertEquals("2027-03-01", EstadoDelViaje.diaSiguiente("2027-02-28"))
        assertEquals("2028-02-29", EstadoDelViaje.diaSiguiente("2028-02-28"))
        assertEquals("2028-01-01", EstadoDelViaje.diaSiguiente("2027-12-31"))
        // años de dos cifras: son esos años, no 19xx
        assertEquals("0050-01-02", EstadoDelViaje.diaSiguiente("0050-01-01"))
    }

    @Test
    fun fechasYZonasInvalidasSonUnErrorDelLlamador() {
        for (f in listOf("2027-02-30", "2027-13-01", "2027-00-10", "27-02-01", "2027-02-01\n", "2027-02-0١")) {
            assertThrows(f, IllegalArgumentException::class.java) { EstadoDelViaje.diaSiguiente(f) }
        }
        assertThrows(IllegalArgumentException::class.java) { EstadoDelViaje.inicioDelDia("2027-02-01", "Marte/Base") }
        assertThrows(IllegalArgumentException::class.java) { PlanDelViaje(EstadoViaje.PLANIFICADO, null, null, zona) }
    }

    @Test
    fun laZonaNoDistingueMayusculasComoEnElServidor() {
        val bien = EstadoDelViaje.inicioDelDia("2027-02-18", "America/New_York")
        assertEquals(bien, EstadoDelViaje.inicioDelDia("2027-02-18", "America/new_york"))
        assertEquals(bien, EstadoDelViaje.inicioDelDia("2027-02-18", "AMERICA/NEW_YORK"))
        // nombres nuevos y viejos de la base de zonas (el servidor acepta los dos)
        for (z in listOf("Asia/Ho_Chi_Minh", "Asia/Saigon", "America/Argentina/Buenos_Aires", "Europe/Kyiv", "Asia/Kolkata", "Etc/GMT+3")) {
            EstadoDelViaje.inicioDelDia("2027-02-18", z)
        }
    }

    @Test
    fun cierreYBordes() {
        assertNull(EstadoDelViaje.cierrePorFechas(null, zona))
        val cierre = EstadoDelViaje.cierrePorFechas("2027-02-20", zona)!!
        assertEquals(EstadoDelViaje.inicioDelDia("2027-02-21", zona), cierre)
        val plan = PlanDelViaje(null, "2027-02-18", "2027-02-20", zona)
        val inicio = EstadoDelViaje.inicioDelDia("2027-02-18", zona)
        assertEquals(EstadoViaje.PLANIFICADO, EstadoDelViaje.estado(plan, inicio - 1))
        assertEquals(EstadoViaje.EN_CURSO, EstadoDelViaje.estado(plan, inicio))
        assertEquals(EstadoViaje.EN_CURSO, EstadoDelViaje.estado(plan, cierre - 1))
        assertEquals(EstadoViaje.CERRADO, EstadoDelViaje.estado(plan, cierre))
        // el manual manda aunque las fechas digan otra cosa
        assertEquals(EstadoViaje.EN_CURSO, EstadoDelViaje.estado(plan.copy(estadoManual = EstadoViaje.EN_CURSO), cierre + 1))
        assertEquals(EstadoViaje.CERRADO, EstadoDelViaje.estado(plan.copy(estadoManual = EstadoViaje.CERRADO), inicio - 1))
        // sin fecha de fin nunca se cierra solo
        assertEquals(EstadoViaje.EN_CURSO, EstadoDelViaje.estado(plan.copy(fechaFin = null), Long.MAX_VALUE / 2))
    }
}
