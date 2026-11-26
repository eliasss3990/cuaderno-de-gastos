package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Nivel
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.Tono
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
class HoyPantallaTest {
    @get:Rule
    val compose = createComposeRule()

    /** El jueves 18 del viaje de ejemplo, como lo arma ArmadoDeHoy. */
    private val dia = HoyEstado(
        cargando = false,
        titulo = "Brasil 2027 🌴",
        fecha = "HOY · JUEVES 18 DE FEBRERO",
        dia = "día 4 de 14",
        totales = listOf(
            TotalEnPantalla("Guaraníes", "PYG", "₲ 250.000", "Para hoy: ₲ 290.000", 86, Nivel.CERCA),
            TotalEnPantalla("Reales", "BRL", "R$ 150,40", "Para hoy: R$ 200,00", 75, Nivel.BIEN),
        ),
        gastos = listOf(
            GastoEnPantalla("1", "🍽️", "#FDE3D3", "Almuerzo en familia", "Restaurante Do Porto · Crédito", "🦁 Papá · 13:48", "R$ 137,50", "BRL", false),
            GastoEnPantalla("2", "🛣️", "#E8E4F3", "Peaje", "Ruta BR-277 · Pix", "🦊 Mamá · 12:10", "R$ 12,90", "BRL", true),
            GastoEnPantalla("3", "🍽️", "#FDE3D3", "Café", "Efectivo", "🦁 Papá · 09:20", "₲ 15.000", "PYG", false),
            GastoEnPantalla("4", "🛒", "#E3F1E4", "Supermercado", "Super Ñandú · Débito", "🦜 Lu · 08:05", "₲ 235.000", "PYG", false),
        ),
        sincronizacion = "Al día",
        tono = Tono.BIEN,
    )

    @Test
    fun unDiaConGastos() {
        var cargar = 0
        compose.setContent { TemaCuaderno { HoyPantalla(dia, AccionesDeHoy(alCargarGasto = { cargar++ })) } }
        compose.onRoot().captureRoboImage("build/capturas/hoy.png")
        compose.onNodeWithText("usaste 86 %").assertExists()
        compose.onNodeWithText("Sin enviar", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("＋  Cargar gasto").performClick()
        assertEquals(1, cargar)
    }

    @Test
    fun unDiaSinGastos() {
        compose.setContent { TemaCuaderno { HoyPantalla(
                    dia.copy(
                        gastos = emptyList(),
                        // a primera hora, sin gastos: todo en cero y lo que hay para hoy a la vista
                        totales = listOf(
                            TotalEnPantalla("Guaraníes", "PYG", "₲ 0", "Para hoy: ₲ 290.000", 0, Nivel.BIEN),
                            TotalEnPantalla("Reales", "BRL", "R$ 0,00", "Para hoy: R$ 200,00", 0, Nivel.BIEN),
                        ),
                    ),
                    AccionesDeHoy(),
                ) } }
        compose.onRoot().captureRoboImage("build/capturas/hoy-vacio.png")
        compose.onNodeWithText("Todavía no hay gastos de hoy").assertExists()
    }

    @Test
    fun conUnViajeAElegirElTituloSeToca() {
        var elegir = 0
        compose.setContent { TemaCuaderno { HoyPantalla(dia, AccionesDeHoy(alElegirViaje = { elegir++ })) } }
        compose.onNodeWithText("Brasil 2027 🌴").performClick()
        assertEquals(1, elegir)
    }

    @Test
    fun sinEnviarYPasadoDelTope() {
        val e = dia.copy(
            sincronizacion = "2 sin enviar", tono = Tono.PENDIENTE,
            totales = listOf(TotalEnPantalla("Guaraníes", "PYG", "₲ 12.500.000", "Para hoy: ₲ 290.000", 112, Nivel.SUPERADO), dia.totales[1]),
        )
        compose.setContent { TemaCuaderno { HoyPantalla(e, AccionesDeHoy()) } }
        compose.onRoot().captureRoboImage("build/capturas/hoy-sin-enviar-y-pasado.png")
    }

    @Test
    @Config(qualifiers = "w360dp-h640dp-xxhdpi")
    fun conLetraAlDoble() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { HoyPantalla(dia, AccionesDeHoy()) } }
        compose.onRoot().captureRoboImage("build/capturas/hoy-letra-200.png")
    }
}
