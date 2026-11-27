package com.eliasgonzalez.cuadernodegastos.ui.componentes.botones

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.CargarGastoEstado
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.GastoGuardado
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.NuevoViajeEstado
import com.eliasgonzalez.cuadernodegastos.pantallas.unirse.UnirseEstado
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** La regla común: una acción hecha se ve igual que en curso hasta que la pantalla se va, y no se vuelve a tocar. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BotonesTest {
    @get:Rule
    val compose = createComposeRule()

    private fun probar(peligro: Boolean) {
        var toques = 0
        var accion by mutableStateOf(EstadoDeAccion.LISTA)
        val listo = if (peligro) "Enviar" else "Guardar"
        val enCurso = if (peligro) "Enviando…" else "Guardando…"
        compose.setContent {
            TemaCuaderno {
                if (peligro) BotonDePeligro(listo, { toques++ }, accion = accion, textoEnCurso = enCurso)
                else BotonPrincipal(listo, { toques++ }, accion = accion, textoEnCurso = enCurso)
            }
        }
        compose.onNodeWithText(listo).performClick()
        accion = EstadoDeAccion.EN_CURSO
        compose.onNodeWithText(enCurso).assertIsNotEnabled()
        accion = EstadoDeAccion.HECHA
        // terminada: sigue "…ando" (no vuelve un instante a su estado normal) y otro toque no hace nada
        compose.onNodeWithText(enCurso).assertIsNotEnabled().performClick()
        compose.onNodeWithText(listo).assertDoesNotExist()
        assertEquals(1, toques)
    }

    @Test
    fun hechaSeVeComoEnCursoEnElPrincipal() = probar(peligro = false)

    @Test
    fun hechaSeVeComoEnCursoEnElDePeligro() = probar(peligro = true)

    @Test
    fun cadaPantallaTraduceSuEstadoALaAccionComun() {
        val g = CargarGastoEstado()
        assertEquals(EstadoDeAccion.LISTA, g.accion)
        assertEquals(EstadoDeAccion.EN_CURSO, g.copy(enviando = true).accion)
        assertEquals(EstadoDeAccion.HECHA, g.copy(listo = true, guardado = GastoGuardado("g", "₲ 1")).accion)
        // cerrar sin guardar (editando sin cambios) no es una acción hecha
        assertEquals(EstadoDeAccion.LISTA, g.copy(listo = true).accion)
        assertEquals(EstadoDeAccion.HECHA, NuevoViajeEstado(enviando = true, entrarA = "v").accion)
        assertEquals(EstadoDeAccion.EN_CURSO, NuevoViajeEstado(enviando = true).accion)
        assertEquals(EstadoDeAccion.HECHA, UnirseEstado(enviando = true, entrarA = "v").accion)
        assertEquals(EstadoDeAccion.LISTA, UnirseEstado().accion)
    }
}
