package com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
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
class NuevoViajePantallaTest {
    @get:Rule
    val compose = createComposeRule()

    private val monedas = listOf(MonedaElegible(Moneda("PYG", 0, "₲"), "Guaraní", true), MonedaElegible(Moneda("BRL", 2, "R$"), "Real", true))
    private val datos = NuevoViajeEstado(
        nombre = "Brasil 2027", fechaInicio = "2027-02-15", fechaFin = "2027-02-28", zona = "America/Asuncion", monedas = monedas, apodo = "Papá",
        arranque = Arranque.FALTA, salidaParaLeer = "15 de febrero", ciudad = "Asunción", dias = 14,
    )

    @Test
    fun paso1ComoElPlanYSusToques() {
        val tocado = mutableListOf<String>()
        compose.setContent {
            TemaCuaderno {
                NuevoViajePantalla(datos, AccionesDeNuevoViaje(alCerrar = { tocado += "cerrar" }, alCambiarSinFin = { tocado += "sinfin" }, alCambiarMoneda = { tocado += it }, alElegirEmoji = { tocado += "emoji$it" }, alSeguir = { tocado += "seguir" }))
            }
        }
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-1.png")
        compose.onNodeWithText("15 feb 2027").assertExists()
        compose.onNodeWithText("28 feb 2027").assertExists()
        compose.onNodeWithText("Todavía no sé cuándo volvemos").performClick()
        compose.onNodeWithText("R$ Real").performClick()
        compose.onNodeWithContentDescription("Elegir 🦊").performClick()
        compose.onNodeWithText("Siguiente: tope y efectivo").performClick()
        assertEquals(listOf("sinfin", "BRL", "emoji1", "seguir"), tocado)
    }

    @Test
    fun paso1VacioYConErrores() {
        val vacio = NuevoViajeEstado(zona = "America/Asuncion", monedas = monedas, ciudad = "Asunción")
        compose.setContent { TemaCuaderno { NuevoViajePantalla(vacio, AccionesDeNuevoViaje()) } }
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-1-vacio.png")
        compose.onNodeWithText("Ej.: Brasil 2027").assertExists()
    }

    @Test
    fun paso1ConErrores() {
        val conErrores = NuevoViajeEstado(
            zona = "America/Asuncion", monedas = monedas.map { it.copy(elegida = false) }, ciudad = "Asunción",
            errores = mapOf("nombre" to com.eliasgonzalez.cuadernodegastos.R.string.nuevo_falta_nombre, "monedas" to com.eliasgonzalez.cuadernodegastos.R.string.nuevo_falta_moneda, "apodo" to com.eliasgonzalez.cuadernodegastos.R.string.nuevo_falta_apodo),
        )
        compose.setContent { TemaCuaderno { NuevoViajePantalla(conErrores, AccionesDeNuevoViaje()) } }
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-1-errores.png")
        compose.onNodeWithText("Poné un nombre para el viaje.").assertExists()
    }

    @Test
    fun paso2ComoElPlan() {
        val estado = datos.copy(
            paso = 2,
            topes = mapOf("PYG" to "10.000.000", "BRL" to "5.600,00"),
            efectivo = mapOf("PYG" to "1.500.000", "BRL" to "400,00"),
            objetivos = "Conocer las Cataratas, dos días de compras, no pasarnos del tope.",
            promedios = listOf(PromedioSugerido(Moneda("PYG", 0, "₲"), "₲ 714.285", "10.000.000 ÷ 14"), PromedioSugerido(Moneda("BRL", 2, "R$"), "R$ 400,00", "5.600,00 ÷ 14")),
        )
        var guardado = false
        compose.setContent { TemaCuaderno { NuevoViajePantalla(estado, AccionesDeNuevoViaje(alGuardar = { guardado = true })) } }
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-2.png")
        compose.onNodeWithText("Promedio diario sugerido · 14 días").assertExists()
        compose.onNodeWithText("Crear viaje").performClick()
        assertEquals(true, guardado)
    }

    @Test
    fun cerrarConAlgoCargadoPreguntaAntes() {
        var cerrado = 0
        compose.setContent { TemaCuaderno { NuevoViajePantalla(datos, AccionesDeNuevoViaje(alCerrar = { cerrado++ })) } }
        compose.onNodeWithContentDescription("Cerrar").performClick()
        compose.onAllNodes(isRoot()).onLast().captureRoboImage("build/capturas/nuevo-viaje-1-salir.png")
        compose.onNodeWithText("Seguir cargando").performClick()
        assertEquals(0, cerrado)
        compose.onNodeWithContentDescription("Cerrar").performClick()
        compose.onNodeWithText("Salir").performClick()
        assertEquals(1, cerrado)
    }

    @Test
    fun siguienteDesdeElNombreAbreElCalendarioDeLaSalida() {
        compose.setContent { TemaCuaderno { NuevoViajePantalla(datos, AccionesDeNuevoViaje()) } }
        compose.onNodeWithText("Brasil 2027").performImeAction()
        compose.onNodeWithText("Listo").assertExists()
    }

    @Test
    fun cerrarSinNadaCargadoSaleDirecto() {
        var cerrado = 0
        compose.setContent { TemaCuaderno { NuevoViajePantalla(NuevoViajeEstado(monedas = monedas, ciudad = "Asunción"), AccionesDeNuevoViaje(alCerrar = { cerrado++ })) } }
        compose.onNodeWithContentDescription("Cerrar").performClick()
        assertEquals(1, cerrado)
    }

    @Test
    fun sinFechaDeRegresoElCampoQuedaApagado() {
        compose.setContent { TemaCuaderno { NuevoViajePantalla(datos.copy(sinFechaFin = true, fechaFin = null), AccionesDeNuevoViaje()) } }
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-1-sin-regreso.png")
        compose.onNodeWithText("Fecha de regreso").assertExists()
    }

    @Test
    @Config(qualifiers = "+w390dp-h1400dp")
    fun conLetraAlDobleLasFechasVanUnaDebajoDeLaOtra() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { NuevoViajePantalla(datos, AccionesDeNuevoViaje()) } }
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-1-letra-200.png")
    }

    @Test
    fun paso2CreandoYConUnaMoneda() {
        val estado = datos.copy(paso = 2, monedas = monedas.take(1), enviando = true)
        compose.mainClock.autoAdvance = false
        compose.setContent { TemaCuaderno { NuevoViajePantalla(estado, AccionesDeNuevoViaje()) } }
        // la ruedita gira: se avanza el reloj para capturar un cuadro con el arco a la vista
        compose.mainClock.advanceTimeBy(700)
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-2-creando.png")
        compose.onNodeWithText("Creando…").assertExists()
    }

    @Test
    fun mientrasCreaVolverNoHaceNada() {
        var volvio = 0
        compose.setContent { TemaCuaderno { NuevoViajePantalla(datos.copy(paso = 2, enviando = true), AccionesDeNuevoViaje(alVolver = { volvio++ })) } }
        compose.onNodeWithContentDescription("Volver").performClick()
        assertEquals(0, volvio)
    }

    @Test
    @Config(qualifiers = "+w390dp-h1400dp")
    fun paso2ConLetraAlDoble() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { NuevoViajePantalla(datos.copy(paso = 2), AccionesDeNuevoViaje()) } }
        compose.onRoot().captureRoboImage("build/capturas/nuevo-viaje-2-letra-200.png")
    }
}
