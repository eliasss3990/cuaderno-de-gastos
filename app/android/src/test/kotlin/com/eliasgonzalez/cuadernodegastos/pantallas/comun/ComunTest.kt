package com.eliasgonzalez.cuadernodegastos.pantallas.comun

import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.red.Rechazo
import com.eliasgonzalez.cuadernodegastos.red.Resultado
import org.junit.Assert.assertEquals
import org.junit.Test

class ComunTest {
    @Test
    fun cadaFallaTieneSuMensaje() {
        assertEquals(R.string.alta_sin_conexion, mensajeDeFalla(Resultado.SinConexion))
        assertEquals(R.string.alta_incierta, mensajeDeFalla(Resultado.Incierto))
        assertEquals(R.string.alta_app_desactualizada, mensajeDeFalla(Resultado.AppDesactualizada))
        assertEquals(R.string.alta_codigo_invalido, mensajeDeFalla(Resultado.Rechazado(Rechazo.CODIGO_INVALIDO, "x")))
        assertEquals(R.string.alta_viaje_completo, mensajeDeFalla(Resultado.Rechazado(Rechazo.VIAJE_COMPLETO, "x")))
        assertEquals(R.string.alta_demasiados_intentos, mensajeDeFalla(Resultado.Rechazado(Rechazo.DEMASIADOS_INTENTOS, "x")))
        val otro = Rechazo.entries.first { it !in setOf(Rechazo.CODIGO_INVALIDO, Rechazo.VIAJE_COMPLETO, Rechazo.DEMASIADOS_INTENTOS) }
        assertEquals(R.string.alta_rechazada, mensajeDeFalla(Resultado.Rechazado(otro, "x")))
    }

    @Test
    fun lasFechasLasCiudadesYLasMonedas() {
        assertEquals("15 feb 2027", Formatos.fechaCorta("2027-02-15"))
        assertEquals("15 de febrero", Formatos.fechaLarga("2027-02-15"))
        assertEquals("1 de diciembre", Formatos.fechaLarga("2027-12-01"))
        assertEquals("Asunción", Formatos.ciudad("America/Asuncion"))
        assertEquals("Guaraní", Formatos.nombreDeMoneda("PYG"))
        assertEquals("Real", Formatos.nombreDeMoneda("BRL"))
    }
}
