package com.eliasgonzalez.cuadernodegastos.pantallas.bienvenida

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class BienvenidaPantallaTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun seVeComoLaMaquetaYAvisaCadaBoton() {
        var tocado = ""
        compose.setContent { TemaCuaderno { BienvenidaPantalla({ tocado = "crear" }, { tocado = "codigo" }) } }
        compose.onNodeWithText("Cuaderno de Gastos").assertExists()
        compose.onNodeWithText("Para crear el viaje o unirte necesitás internet solo esta vez. Después funciona sin señal.").assertExists()
        compose.onNodeWithText("Crear un viaje").performClick()
        assertEquals("crear", tocado)
        compose.onNodeWithText("Unirme a un viaje con un código").performClick()
        assertEquals("codigo", tocado)
        compose.onRoot().captureRoboImage("build/capturas/bienvenida.png")
    }

    @Test
    @Config(qualifiers = "w360dp-h640dp-xxhdpi")
    fun conLetraAlDobleEnUnaPantallaBajaNoSeEncima() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { BienvenidaPantalla({}, {}) } }
        compose.onRoot().captureRoboImage("build/capturas/bienvenida-letra-200.png")
        compose.onNodeWithText("Unirme a un viaje con un código").performScrollTo().assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w844dp-h390dp-xxhdpi")
    fun enHorizontal() {
        compose.setContent { TemaCuaderno { BienvenidaPantalla({}, {}) } }
        compose.onRoot().captureRoboImage("build/capturas/bienvenida-horizontal.png")
        compose.onNodeWithText("Crear un viaje").performScrollTo().assertIsDisplayed()
    }
}
