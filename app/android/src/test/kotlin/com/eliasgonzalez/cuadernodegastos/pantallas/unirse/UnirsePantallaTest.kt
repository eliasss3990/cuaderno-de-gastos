package com.eliasgonzalez.cuadernodegastos.pantallas.unirse

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
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
class UnirsePantallaTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun muestraLoCargadoYAvisaCadaToque() {
        val tocado = mutableListOf<String>()
        compose.setContent {
            TemaCuaderno {
                UnirsePantalla(
                    UnirseEstado(codigo = "K7M4-9XQ2", apodo = "Lu", emoji = 3),
                    AccionesDeUnirse(
                        alCambiarCodigo = { tocado += "codigo:$it" },
                        alCambiarApodo = { tocado += "apodo:$it" },
                        alElegirEmoji = { tocado += "emoji:$it" },
                        alVolver = { tocado += "volver" },
                        alUnirse = { tocado += "unirse" },
                    ),
                )
            }
        }
        compose.onRoot().captureRoboImage("build/capturas/unirse.png")
        compose.onNodeWithText("K7M4-9XQ2").performTextReplacement("ABCD")
        compose.onNodeWithText("Lu").performTextReplacement("Ana")
        compose.onNodeWithContentDescription("Elegir 🐼").performClick()
        compose.onNodeWithText("Unirme al viaje").performClick()
        // el estado de la prueba no cambia, así que el campo puede volver a avisar el valor que muestra: se miran los avisos nuevos
        assertEquals(listOf("codigo:ABCD", "apodo:Ana", "emoji:4", "unirse"), tocado.filter { it != "codigo:K7M4-9XQ2" && it != "apodo:Lu" })
    }

    @Test
    fun conUnMensajeLoMuestraYMientrasEnviaNoDejaTocar() {
        var unido = 0
        var volvio = 0
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TemaCuaderno { UnirsePantalla(UnirseEstado(codigo = "K7M4-9XQ2", apodo = "Lu", enviando = true), AccionesDeUnirse(alUnirse = { unido++ }, alVolver = { volvio++ })) }
        }
        compose.mainClock.advanceTimeBy(700)
        compose.onRoot().captureRoboImage("build/capturas/unirse-enviando.png")
        compose.onNodeWithText("Uniéndote…").performClick()
        compose.onNodeWithContentDescription("Volver").performClick()
        assertEquals(0 to 0, unido to volvio)
    }

    @Test
    fun vacioYConErroresEnCadaCampo() {
        compose.setContent { TemaCuaderno { UnirsePantalla(UnirseEstado(errores = mapOf("codigo" to com.eliasgonzalez.cuadernodegastos.R.string.unirse_falta_codigo, "apodo" to com.eliasgonzalez.cuadernodegastos.R.string.unirse_falta_nombre)), AccionesDeUnirse()) } }
        compose.onRoot().captureRoboImage("build/capturas/unirse-errores.png")
        compose.onNodeWithText("Ej.: K7M4-9XQ2").assertExists()
        compose.onNodeWithText("Poné tu apodo en este viaje.").assertExists()
    }

    @Test
    fun codigoQueNoSirveYAvisoDeSinConexion() {
        compose.setContent {
            TemaCuaderno {
                UnirsePantalla(
                    UnirseEstado(codigo = "K7M4-9XQ3", apodo = "Lu", errores = mapOf("codigo" to com.eliasgonzalez.cuadernodegastos.R.string.alta_codigo_invalido)),
                    AccionesDeUnirse(),
                )
            }
        }
        compose.onRoot().captureRoboImage("build/capturas/unirse-codigo-no-sirve.png")
    }

    @Test
    fun sinConexion() {
        compose.setContent { TemaCuaderno { UnirsePantalla(UnirseEstado(codigo = "K7M4-9XQ2", apodo = "Lu", mensaje = com.eliasgonzalez.cuadernodegastos.R.string.alta_sin_conexion), AccionesDeUnirse()) } }
        compose.onRoot().captureRoboImage("build/capturas/unirse-sin-conexion.png")
        compose.onNodeWithText("No hay internet. Para entrar al viaje hace falta conexión esta vez; después funciona sin señal.").assertExists()
    }

    @Test
    fun volverConAlgoCargadoPreguntaYVacioSaleDirecto() {
        var volvio = 0
        var estado by androidx.compose.runtime.mutableStateOf(UnirseEstado(codigo = "K7M4"))
        compose.setContent { TemaCuaderno { UnirsePantalla(estado, AccionesDeUnirse(alVolver = { volvio++ })) } }
        compose.onNodeWithContentDescription("Volver").performClick()
        compose.onNodeWithText("¿Salir sin unirte al viaje?").assertExists()
        compose.onNodeWithText("Seguir cargando").performClick()
        assertEquals(0, volvio)
        estado = UnirseEstado()
        compose.onNodeWithContentDescription("Volver").performClick()
        assertEquals(1, volvio)
    }

    @Test
    @Config(qualifiers = "w360dp-h640dp-xxhdpi")
    fun conLetraAlDoble() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { UnirsePantalla(UnirseEstado(codigo = "K7M4-9XQ2", apodo = "Lu"), AccionesDeUnirse()) } }
        compose.onRoot().captureRoboImage("build/capturas/unirse-letra-200.png")
        compose.onNodeWithText("Unirme al viaje").performScrollTo().assertIsDisplayed()
    }
}
