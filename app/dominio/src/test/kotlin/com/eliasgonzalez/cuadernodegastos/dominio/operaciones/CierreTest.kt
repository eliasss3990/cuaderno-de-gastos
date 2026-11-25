package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** El cierre del viaje y los intervalos del almacén, fuera de los escenarios de conformidad. */
class CierreTest {
    private val cierre = 1803006000000L // inicio del 2027-02-19 en Asunción
    private val ahora = cierre + 1000

    private fun viaje(vararg campos: Pair<String, String>): AlmacenMemoria {
        val a = AlmacenMemoria()
        a.crearEntidad("trip", "v1")
        for ((c, v) in campos) a.escribirCampo("trip", "v1", c, JsonPrimitive(v), "m1")
        return a
    }

    @Test
    fun guardasSobreEstadosQueLaValidacionNoDejaPasar() {
        val vacio = AlmacenMemoria()
        CierreDelViaje.sincronizar(vacio, ahora, ahora)
        assertEquals(emptyList<IntervaloCierre>(), vacio.intervalosDeCierre())
        val sinZona = viaje("fecha_fin" to "2027-02-18")
        CierreDelViaje.sincronizar(sinZona, ahora, ahora)
        assertEquals(emptyList<IntervaloCierre>(), sinZona.intervalosDeCierre())
        val manualRaro = viaje("zona_horaria" to "America/Asuncion", "fecha_fin" to "2027-02-18", "estado_manual" to "OTRO")
        CierreDelViaje.sincronizar(manualRaro, ahora, null)
        assertEquals(listOf(IntervaloCierre(cierre, null, IntervaloCierre.Causa.FECHAS)), manualRaro.intervalosDeCierre())
    }

    @Test
    fun cambioPosteriorYRelojQueRetrocede() {
        val a = viaje("zona_horaria" to "America/Asuncion", "fecha_fin" to "2027-02-18")
        CierreDelViaje.sincronizar(a, ahora, cierre + 500)
        assertEquals(listOf(IntervaloCierre(cierre + 500, null, IntervaloCierre.Causa.FECHAS)), a.intervalosDeCierre())
        val b = viaje("zona_horaria" to "America/Asuncion", "fecha_fin" to "2027-02-18")
        CierreDelViaje.sincronizar(b, ahora, null)
        CierreDelViaje.sincronizar(b, cierre - 5000, null) // el reloj retrocede: sin una operación, el cierre sigue
        CierreDelViaje.sincronizar(b, ahora + 5, null)
        assertEquals(listOf(IntervaloCierre(cierre, null, IntervaloCierre.Causa.FECHAS)), b.intervalosDeCierre())
    }

    @Test
    fun unCierreNuevoNuncaEmpiezaAntesDeQueTermineElAnterior() {
        // cerrado a mano, reabierto en 2000, y otra vez cerrado con una operación creada antes (1500)
        val a = viaje("zona_horaria" to "America/Asuncion", "estado_manual" to "CERRADO")
        CierreDelViaje.sincronizar(a, 1000, 1000)
        a.escribirCampo("trip", "v1", "estado_manual", JsonPrimitive("EN_CURSO"), "m2")
        CierreDelViaje.sincronizar(a, 2000, 2000)
        a.escribirCampo("trip", "v1", "estado_manual", JsonPrimitive("CERRADO"), "m3")
        CierreDelViaje.sincronizar(a, 3000, 1500)
        assertEquals(
            listOf(IntervaloCierre(1000, 2000, IntervaloCierre.Causa.MANUAL), IntervaloCierre(2000, null, IntervaloCierre.Causa.MANUAL)),
            a.intervalosDeCierre(),
        )
    }

    @Test
    fun dentroDeUnCierreYHoraDeCreacion() {
        val ivs = listOf(IntervaloCierre(10, 20, IntervaloCierre.Causa.MANUAL), IntervaloCierre(30, null, IntervaloCierre.Causa.FECHAS))
        for (ms in listOf(10L, 19, 30, 31, 1_000_000_000_000_000)) assertTrue("$ms", CierreDelViaje.dentroDeUnCierre(ivs, ms))
        for (ms in listOf(0L, 9, 20, 25, 29)) assertFalse("$ms", CierreDelViaje.dentroDeUnCierre(ivs, ms))
        assertFalse(CierreDelViaje.dentroDeUnCierre(emptyList(), 5))
        val op = Operacion("o", "t", "e", "i", "${1234L.toString(16).padStart(13, '0')}-0001-018f3a6e-0000-7000-8000-00000000000a", kotlinx.serialization.json.JsonObject(emptyMap()), 1)
        assertEquals(1234L, CierreDelViaje.horaDeCreacion(op))
    }

    @Test
    fun intervalosDelAlmacen() {
        val a = AlmacenMemoria()
        assertThrows(IllegalStateException::class.java) { a.cerrarIntervalo(10) }
        a.abrirIntervalo(100, IntervaloCierre.Causa.MANUAL)
        assertThrows(IllegalStateException::class.java) { a.abrirIntervalo(150, IntervaloCierre.Causa.FECHAS) }
        assertThrows(IllegalStateException::class.java) { a.cerrarIntervalo(100) }
        assertThrows(IllegalStateException::class.java) { a.cerrarIntervalo(99) }
        a.cerrarIntervalo(200)
        assertThrows(IllegalStateException::class.java) { a.cerrarIntervalo(300) }
        assertThrows(IllegalStateException::class.java) { a.abrirIntervalo(199, IntervaloCierre.Causa.FECHAS) }
        a.abrirIntervalo(200, IntervaloCierre.Causa.FECHAS)
        a.cerrarIntervalo(300)
        assertThrows(IllegalStateException::class.java) { a.abrirIntervalo(299, IntervaloCierre.Causa.MANUAL) }
        // una transacción que falla los deshace
        try {
            a.transaccion {
                a.abrirIntervalo(300, IntervaloCierre.Causa.MANUAL)
                a.cerrarIntervalo(400)
                error("falla")
            }
        } catch (_: IllegalStateException) {
        }
        assertEquals(
            listOf(IntervaloCierre(100, 200, IntervaloCierre.Causa.MANUAL), IntervaloCierre(200, 300, IntervaloCierre.Causa.FECHAS)),
            a.intervalosDeCierre(),
        )
    }
}
