package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** El volver del sistema: primero cierra el teclado del monto y recién después sale. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class VolverEnCargarGastoTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun volverPrimeroCierraElTecladoDelMontoYDespuesSale() {
        var cerrado = 0
        val estado = CargarGastoEstado(cargando = false, monedas = listOf(Moneda("BRL", 2, "R$")), moneda = "BRL", diaImputado = "2027-02-18", hoy = "2027-02-18", diaPropuesto = "2027-02-18")
        compose.setContent { TemaCuaderno { CargarGastoPantalla(estado, AccionesDeCargarGasto(alCerrar = { cerrado++ })) } }
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("7").assertDoesNotExist()
        assertEquals(0, cerrado)
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        assertEquals(1, cerrado)
    }
}
