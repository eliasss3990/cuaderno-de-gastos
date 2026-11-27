package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto

import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
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
class CargarGastoPantallaTest {
    @get:Rule
    val compose = createComposeRule()

    private val base = CargarGastoEstado(
        cargando = false, monedas = listOf(Moneda("PYG", 0, "₲"), Moneda("BRL", 2, "R$")), nombresDeMoneda = mapOf("PYG" to "Guaraní", "BRL" to "Real"),
        moneda = "BRL", categorias = listOf(OpcionDeCategoria("c1", "Comida", "🍽️"), OpcionDeCategoria("c2", "Nafta", "⛽"), OpcionDeCategoria("c3", "Peajes", "🛣️"), OpcionDeCategoria("otro", "Otro", "📦")),
        categoria = "c1", sugerenciasDeLugar = listOf("Do Porto", "Churrascaria Rio"), diaImputado = "2027-02-18", hoy = "2027-02-18", diaPropuesto = "2027-02-18", finDelViaje = "2027-02-28",
    )

    @Test
    fun vacioYSusToques() {
        val tocado = mutableListOf<String>()
        compose.setContent {
            TemaCuaderno {
                CargarGastoPantalla(
                    base,
                    AccionesDeCargarGasto(
                        alTocarTecla = { tocado += "t$it" }, alBorrar = { tocado += "borrar" }, alElegirMoneda = { tocado += it },
                        alElegirCategoria = { tocado += it }, alElegirMetodo = { tocado += it }, alCambiarLugar = { tocado += "lugar:$it" }, alGuardar = { tocado += "guardar" },
                    ),
                )
            }
        }
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-vacio.png")
        compose.onNodeWithText("7").performClick()
        compose.onNodeWithText(",").performClick()
        compose.onNodeWithContentDescription("Borrar; mantener apretado para borrar todo").performClick()
        compose.onNodeWithText("₲ Guaraní").performClick()
        compose.onNodeWithText("Nafta").performClick()
        compose.onNodeWithText("Pix").performScrollTo().performClick()
        compose.onNodeWithText("Do Porto").performScrollTo().performClick()
        compose.onNodeWithText("Guardar gasto").assertIsDisplayed().performClick()
        assertEquals(listOf("t7", "t,", "borrar", "PYG", "c2", "PIX", "lugar:Do Porto", "guardar"), tocado)
    }

    @Test
    fun conMontoYMasDatosConTarjeta() {
        compose.setContent {
            TemaCuaderno { CargarGastoPantalla(base.copy(montoTexto = "137,50", metodo = "CREDITO", lugar = "Restaurante Do Porto", mostrarMas = true), AccionesDeCargarGasto()) }
        }
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-completo.png")
        compose.onNodeWithText("Tarjeta").performScrollTo()
        compose.onNodeWithText("18 de febrero (hoy)", substring = true).assertExists()
    }

    @Test
    fun conErrorYRechazo() {
        compose.setContent {
            TemaCuaderno {
                CargarGastoPantalla(
                    base.copy(errorDelMonto = com.eliasgonzalez.cuadernodegastos.R.string.gasto_monto_falta, mensaje = com.eliasgonzalez.cuadernodegastos.R.string.gasto_fuera_del_viaje),
                    AccionesDeCargarGasto(),
                )
            }
        }
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-errores.png")
        compose.onNodeWithText("Falta el monto.").assertExists()
        // un solo texto bajo el monto: la ayuda se reemplaza
        compose.onNodeWithText("Tocá los números").assertDoesNotExist()
    }

    @Test
    fun salirConAlgoCargadoPregunta() {
        var cerrado = 0
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base.copy(montoTexto = "5"), AccionesDeCargarGasto(alCerrar = { cerrado++ })) } }
        compose.onNodeWithContentDescription("Cerrar").performClick()
        compose.onNodeWithText("¿Salir sin guardar el gasto?").assertExists()
        compose.onNodeWithText("Salir").performClick()
        assertEquals(1, cerrado)
    }

    @Test
    fun enGuaraniesSinComaConUnMontoLargoYOtroDia() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TemaCuaderno { CargarGastoPantalla(base.copy(moneda = "PYG", montoTexto = "1.250.000", diaImputado = "2027-02-17", enviando = true), AccionesDeCargarGasto()) }
        }
        compose.mainClock.advanceTimeBy(700)
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-guaranies.png")
        compose.onNodeWithText(",").assertDoesNotExist()
        compose.onNodeWithText("Más datos · día: 17 de febrero").assertExists()
    }

    @Test
    fun losOtrosPagosSeAbrenConMas() {
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base, AccionesDeCargarGasto()) } }
        compose.onNodeWithText("Transferencia o QR").assertDoesNotExist()
        compose.onNodeWithText("Otras formas").performScrollTo().performClick()
        compose.onNodeWithText("Transferencia o QR").assertExists()
    }

    @Test
    @Config(qualifiers = "w360dp-h640dp-xxhdpi")
    fun conLetraAlDobleElBotonSigueALaVista() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base.copy(montoTexto = "137,50"), AccionesDeCargarGasto()) } }
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-letra-200.png")
        compose.onNodeWithText("Guardar gasto").assertIsDisplayed()
    }

    @Test
    fun elLugarNoAdmiteMasDeLoQueAceptaLaValidacion() {
        var lugar = ""
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base, AccionesDeCargarGasto(alCambiarLugar = { lugar = it })) } }
        compose.onNodeWithText("Ej.: Restaurante Do Porto").performScrollTo().performTextInput("x".repeat(250))
        assertEquals(200, lugar.length)
    }

    @Test
    fun conSoloOtroNoSeMuestraLaCategoria() {
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base.copy(categorias = listOf(OpcionDeCategoria("otro", "Otro", "📦")), categoria = "otro"), AccionesDeCargarGasto()) } }
        compose.onNodeWithText("Categoría").assertDoesNotExist()
        compose.onNodeWithText("Cómo pagaste").assertExists()
    }

    @Test
    fun laFlechaCierraElTecladoYTocarElMontoLoAbre() {
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base.copy(montoTexto = "125"), AccionesDeCargarGasto()) } }
        compose.onNodeWithContentDescription("Cerrar el teclado").performClick()
        compose.onNodeWithText("7").assertDoesNotExist()
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-sin-teclado.png")
        compose.onNodeWithText("Tocá para cambiar el monto").performClick()
        compose.onNodeWithText("7").assertExists()
    }

    @Test
    fun unMontoDudosoSeVeEnRojoBajoElNumero() {
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base.copy(montoTexto = "12.500", topes = mapOf("BRL" to 1_000_000L), gastado = mapOf("BRL" to 50_000L)), AccionesDeCargarGasto()) } }
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-monto-dudoso.png")
        compose.onNodeWithText("⚠ Con este gasto se pasan del tope del viaje. ¿Está bien el monto?").assertExists()
    }

    @Test
    fun conElTopeYaPasadoElAvisoEsOtroYSeVeSinMonto() {
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base.copy(topes = mapOf("BRL" to 1_000L), gastado = mapOf("BRL" to 5_000L)), AccionesDeCargarGasto()) } }
        compose.onRoot().captureRoboImage("build/capturas/cargar-gasto-tope-pasado.png")
        compose.onNodeWithText("⚠ Ya se pasaron del tope del viaje en esta moneda. Igual podés seguir cargando gastos.").assertExists()
    }

    @Test
    fun laFormaDePagoElegidaSeAnunciaComoCasillaYSePuedeDesmarcar() {
        var tocado = ""
        compose.setContent { TemaCuaderno { CargarGastoPantalla(base.copy(metodo = "EFECTIVO"), AccionesDeCargarGasto(alElegirMetodo = { tocado = it })) } }
        val chip = compose.onNode(androidx.compose.ui.test.hasText("Efectivo") and androidx.compose.ui.test.hasClickAction())
        chip.assert(androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.ToggleableState, androidx.compose.ui.state.ToggleableState.On))
        chip.performScrollTo().performClick()
        assertEquals("EFECTIVO", tocado)
    }
}
