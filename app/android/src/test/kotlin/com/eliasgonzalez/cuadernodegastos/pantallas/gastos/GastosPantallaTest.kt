package com.eliasgonzalez.cuadernodegastos.pantallas.gastos

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.AvisoDeGastos
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.GastoEnPantalla
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
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
class GastosPantallaTest {
    @get:Rule
    val compose = createComposeRule()

    private val lista = GastosEstado(
        cargando = false, sincronizacion = "Al día",
        delViaje = listOf(
            DiaEnPantalla(
                "2027-02-18", "JUEVES 18 FEB", "R$ 150,40 · ₲ 235.000",
                listOf(
                    GastoEnPantalla("1", "🍽️", "#FDE3D3", "Almuerzo en familia", "Restaurante Do Porto · Crédito", "🦁 Papá · 13:48", "R$ 137,50", "BRL", false),
                    GastoEnPantalla("2", "🛣️", "#E8E4F3", "Peaje", "Ruta BR-277 · Pix", "🦊 Mamá · 12:10", "R$ 12,90", "BRL", true),
                    GastoEnPantalla("3", "🛒", "#E3F1E4", "Supermercado", "Super Ñandú · Débito", "🦜 Lu · 08:05", "₲ 235.000", "PYG", false),
                ),
            ),
            DiaEnPantalla(
                "2027-02-17", "MIÉRCOLES 17 FEB", "R$ 95,00",
                listOf(GastoEnPantalla("4", "🎟️", "#FFF1CC", "Cataratas · entradas", "Parque Nacional · Efectivo", "🦊 Mamá · 10:02", "R$ 95,00", "BRL", false)),
            ),
        ),
    )

    @Test
    fun losDiasConSuTotalYTocarUnoAbreSuDetalle() {
        var abierto = ""
        var pestana = -1
        var ir = -1
        compose.setContent { TemaCuaderno { GastosPantalla(lista, 0, AccionesDeGastos(alAbrirGasto = { abierto = it }, alElegirPestana = { pestana = it }, alIrA = { ir = it })) } }
        compose.onRoot().captureRoboImage("build/capturas/gastos.png")
        compose.onNodeWithText("R$ 150,40 · ₲ 235.000", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Peaje", useUnmergedTree = true).performClick()
        assertEquals("2", abierto)
        compose.onNodeWithText("Preparación").performClick()
        compose.onNodeWithText("Hoy").performClick()
        assertEquals(1 to 0, pestana to ir)
    }

    @Test
    fun preparacionVaciaExplicaQueVaAhi() {
        compose.setContent { TemaCuaderno { GastosPantalla(lista.copy(antesDe = "15 feb"), 1, AccionesDeGastos()) } }
        compose.onRoot().captureRoboImage("build/capturas/gastos-preparacion-vacia.png")
        compose.onNodeWithText("Todavía no anotaron gastos de antes del viaje", substring = true).assertExists()
    }

    @Test
    fun enviadoALaPapeleraOfreceDeshacer() {
        var deshecho = 0
        compose.setContent { TemaCuaderno { GastosPantalla(lista, 0, AccionesDeGastos(alDeshacer = { deshecho++ }), AvisoDeGastos.EnPapelera("1", "R$ 137,50")) } }
        compose.onNodeWithText("Gasto enviado a la papelera: R$ 137,50").assertExists()
        compose.onRoot().captureRoboImage("build/capturas/gastos-a-la-papelera.png")
        compose.onNodeWithText("Deshacer").performClick()
        assertEquals(1, deshecho)
    }

    @Test
    @Config(qualifiers = "w360dp-h640dp-xxhdpi")
    fun conLetraAlDoble() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { GastosPantalla(lista, 0, AccionesDeGastos()) } }
        compose.onRoot().captureRoboImage("build/capturas/gastos-letra-200.png")
    }

    @Test
    @Config(qualifiers = "w360dp-h640dp-xxhdpi")
    fun conLetraAlDobleUnaFilaLargaSinEnviarYConMontoGrande() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        val largo = lista.copy(
            delViaje = listOf(
                DiaEnPantalla(
                    "2027-02-18", "HOY · JUEVES 18 FEB", "R\$ 123.456.789,00",
                    listOf(GastoEnPantalla("9", "🏨", "#E8E4F3", "Pousada das Flores Balneario", "Efectivo", "🦁 Papá · 13:48", "R\$ 123.456.789,00", "BRL", true)),
                ),
            ),
        )
        compose.setContent { TemaCuaderno { GastosPantalla(largo, 0, AccionesDeGastos()) } }
        compose.onRoot().captureRoboImage("build/capturas/gastos-letra-200-fila-larga.png")
    }

    @Test
    fun preparacionSinFechaDeInicioYErrorDeLectura() {
        var estado by androidx.compose.runtime.mutableStateOf(lista.copy(antesDe = null))
        compose.setContent { TemaCuaderno { GastosPantalla(estado, 1, AccionesDeGastos()) } }
        compose.onNodeWithText("El viaje todavía no tiene fecha de salida", substring = true).assertExists()
        estado = GastosEstado(cargando = false, noSePudoLeer = true)
        compose.onNodeWithText("No se pudieron leer los gastos.").assertExists()
    }
}
