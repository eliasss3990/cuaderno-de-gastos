package com.eliasgonzalez.cuadernodegastos.ui.componentes.campos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextInputSelection
import androidx.compose.ui.text.TextRange
import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CamposTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun alReformatearLoEscritoElCursorQuedaAlFinal() {
        val guarani = Moneda("PYG", 0, "₲")
        compose.setContent {
            TemaCuaderno {
                var texto by remember { mutableStateOf("") }
                CampoDeTexto("Tope", texto, { texto = Dinero.formatearEntrada(it, guarani) }, ayuda = "monto")
            }
        }
        val campo = compose.onNode(hasSetTextAction())
        campo.performClick()
        for (c in "10000") campo.performTextInput(c.toString())
        val nodo = campo.fetchSemanticsNode()
        assertEquals("10.000", nodo.config[SemanticsProperties.EditableText].text)
        assertEquals(TextRange(6), nodo.config[SemanticsProperties.TextSelectionRange])
    }

    @Test
    fun tocarUnCampoParaElegirSueltaElFocoAntesDeAbrir() {
        val pasos = mutableListOf<String>()
        val foco = object : androidx.compose.ui.focus.FocusManager {
            override fun clearFocus(force: Boolean) { pasos += "soltar" }
            override fun moveFocus(focusDirection: androidx.compose.ui.focus.FocusDirection) = false
        }
        compose.setContent {
            TemaCuaderno {
                androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalFocusManager provides foco) {
                    CampoParaElegir("Fecha", null, { pasos += "abrir" }, ayuda = "Elegí una fecha")
                }
            }
        }
        compose.onNodeWithText("Elegí una fecha").performClick()
        // si no suelta el foco, al cerrarse el calendario Android se lo devuelve al campo de texto y abre el teclado
        assertEquals(listOf("soltar", "abrir"), pasos)
    }

    @Test
    fun elTopeDeLargoNoMueveElCursorAlEscribirEnElMedio() {
        compose.setContent {
            TemaCuaderno {
                var texto by remember { mutableStateOf("") }
                CampoDeTexto("Lugar", texto, { texto = it }, largoMaximo = 5)
            }
        }
        val campo = compose.onNode(hasSetTextAction())
        campo.performClick()
        campo.performTextInput("abcdefg")
        assertEquals("abcde", campo.fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        campo.performTextInputSelection(TextRange(2))
        campo.performTextInput("x")
        // con el tope lleno no entra nada más y el cursor se queda donde estaba
        assertEquals("abcde", campo.fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        assertEquals(TextRange(2), campo.fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange])
    }
}
