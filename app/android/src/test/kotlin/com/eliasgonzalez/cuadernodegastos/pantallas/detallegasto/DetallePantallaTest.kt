package com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto

import androidx.compose.ui.test.assertIsNotEnabled
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
class DetallePantallaTest {
    @get:Rule
    val compose = createComposeRule()

    private val gasto = DetalleEstado(
        cargando = false, emoji = "🍽️", fondo = "#FDE3D3", monto = "R$ 137,50", subtitulo = "Almuerzo en familia · Comida",
        datos = listOf(
            DatoDelGasto("Quién", "🦁 Papá"), DatoDelGasto("Día", "Jueves 18 feb\u00A0·\u00A013:48"), DatoDelGasto("Lugar", "Restaurante Do Porto"),
            DatoDelGasto("Pago", "Crédito · Visa de Papá"),
        ),
    )

    @Test
    fun losDatosYSusAcciones() {
        var editar = 0
        var papelera = 0
        compose.setContent { TemaCuaderno { DetallePantalla(gasto, AccionesDeDetalle(alEditar = { editar++ }, alEnviarAPapelera = { papelera++ })) } }
        compose.onRoot().captureRoboImage("build/capturas/detalle-gasto.png")
        compose.onNodeWithText("Editar").performClick()
        compose.onNodeWithText("Enviar a la papelera").performClick()
        assertEquals(1 to 1, editar to papelera)
    }

    @Test
    fun mientrasSeEnviaNoSeVuelveAMandar() {
        var papelera = 0
        compose.setContent { TemaCuaderno { DetallePantalla(gasto, AccionesDeDetalle(alEnviarAPapelera = { papelera++ }), accion = com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.EstadoDeAccion.EN_CURSO) } }
        compose.onNodeWithText("Enviando a la papelera…").performClick()
        assertEquals(0, papelera)
    }

    @Test
    fun enLaPapeleraNoSeEditaNiSeVuelveAMandarYSeRestaura() {
        var restaurado = 0
        compose.setContent { TemaCuaderno { DetallePantalla(gasto.copy(enPapelera = true), AccionesDeDetalle(alRestaurar = { restaurado++ })) } }
        compose.onRoot().captureRoboImage("build/capturas/detalle-gasto-en-papelera.png")
        compose.onNodeWithText("Restaurar").performClick()
        assertEquals(1, restaurado)
        compose.onNodeWithText("Está en la papelera.").assertExists()
        compose.onNodeWithText("Editar").assertDoesNotExist()
        compose.onNodeWithText("Enviar a la papelera").assertDoesNotExist()
    }

    @Test
    fun siYaNoExisteLoDice() {
        compose.setContent { TemaCuaderno { DetallePantalla(DetalleEstado(cargando = false, noExiste = true), AccionesDeDetalle()) } }
        compose.onNodeWithText("Este gasto ya no existe: alguien lo borró.").assertExists()
    }

    @Test
    fun alVolverDeEditarAvisaYSiFallaLoDice() {
        compose.setContent { TemaCuaderno { DetallePantalla(gasto, AccionesDeDetalle(), fallo = FalloDeDetalle.PAPELERA, aviso = "Cambios guardados") } }
        compose.onNodeWithText("Cambios guardados").assertExists()
        compose.onNodeWithText("No se pudo enviar a la papelera. Probá de nuevo.").assertExists()
        compose.onRoot().captureRoboImage("build/capturas/detalle-gasto-avisos.png")
    }

    @Test
    @Config(qualifiers = "w360dp-h640dp-xxhdpi")
    fun conLetraAlDoble() {
        org.robolectric.RuntimeEnvironment.setFontScale(2f)
        compose.setContent { TemaCuaderno { DetallePantalla(gasto, AccionesDeDetalle()) } }
        compose.onRoot().captureRoboImage("build/capturas/detalle-gasto-letra-200.png")
    }

    @Test
    fun unFalloQueYaNoAplicaNoSeMuestra() {
        // falló mandarla a la papelera, pero otro celular la mandó igual: no se dice "no se pudo restaurar"
        compose.setContent { TemaCuaderno { DetallePantalla(gasto.copy(enPapelera = true), AccionesDeDetalle(), fallo = FalloDeDetalle.PAPELERA) } }
        compose.onNodeWithText("No se pudo restaurar. Probá de nuevo.").assertDoesNotExist()
        compose.onNodeWithText("No se pudo enviar a la papelera. Probá de nuevo.").assertDoesNotExist()
    }

    @Test
    fun restaurarQueFallaLoDiceYMientrasRestauraNoSeVuelveATocar() {
        var restaurado = 0
        compose.setContent { TemaCuaderno { DetallePantalla(gasto.copy(enPapelera = true), AccionesDeDetalle(alRestaurar = { restaurado++ }), accion = com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.EstadoDeAccion.EN_CURSO, fallo = FalloDeDetalle.RESTAURAR) } }
        compose.onNodeWithText("No se pudo restaurar. Probá de nuevo.").assertExists()
        compose.onNodeWithText("Restaurando…").assertIsNotEnabled()
        assertEquals(0, restaurado)
    }

    @Test
    fun mientrasSeMandaALaPapeleraEditarQuedaApagado() {
        compose.setContent { TemaCuaderno { DetallePantalla(gasto, AccionesDeDetalle(), accion = com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.EstadoDeAccion.EN_CURSO) } }
        compose.onNodeWithText("Editar").assertIsNotEnabled()
    }
}
