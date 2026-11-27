// Los botones: de ancho completo, al menos 52 de alto y bordes redondos.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.botones

import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

/**
 * Cómo va la acción de un botón que, al salir bien, cierra la pantalla (guardar, crear, unirse, mandar a la papelera).
 * HECHA nunca vuelve a LISTA y se dibuja igual que EN_CURSO hasta que la pantalla se va: si no, el botón vuelve un
 * instante a su estado normal (en un celular lento se ve como un parpadeo). Solo un error vuelve a LISTA.
 */
enum class EstadoDeAccion {
    LISTA, EN_CURSO, HECHA;

    /** Mientras no está lista se muestra "…ando" con la ruedita y no se puede volver a tocar. */
    val ocupada: Boolean get() = this != LISTA
}

/**
 * El botón principal. Con [accion] ocupada muestra [textoEnCurso] y la ruedita, y no responde a toques (aunque el
 * toque llegue antes de que se redibuje).
 */
@Composable
fun BotonPrincipal(
    texto: String,
    alTocar: () -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
    accion: EstadoDeAccion = EstadoDeAccion.LISTA,
    textoEnCurso: String = texto,
) {
    val cargando = accion.ocupada
    Button(
        onClick = { if (!cargando) alTocar() },
        enabled = habilitado && !cargando,
        modifier = modifier.fillMaxWidth().heightIn(min = Tema.medidas.altoDeBoton),
        shape = Tema.formas.boton,
        // cargando: no se toca, pero mantiene sus colores para que la ruedita y el texto se lean
        colors = if (cargando) {
            ButtonDefaults.buttonColors(disabledContainerColor = Tema.colores.principal, disabledContentColor = Tema.colores.superficie)
        } else {
            ButtonDefaults.buttonColors(containerColor = Tema.colores.principal, contentColor = Tema.colores.superficie)
        },
    ) {
        // con letra grande el texto pasa a dos líneas en vez de cortarse (el alto es mínimo, no fijo)
        if (cargando) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Tema.colores.superficie)
        Text(if (cargando) textoEnCurso else texto, style = Tema.texto.boton, textAlign = TextAlign.Center, modifier = if (cargando) Modifier.padding(start = 10.dp) else Modifier)
    }
}

@Composable
fun BotonSecundario(texto: String, alTocar: () -> Unit, modifier: Modifier = Modifier) =
    BotonConBorde(texto, alTocar, Tema.colores.principal, modifier)

/** Para acciones que borran o revocan; con [accion] igual que [BotonPrincipal]. */
@Composable
fun BotonDePeligro(
    texto: String,
    alTocar: () -> Unit,
    modifier: Modifier = Modifier,
    accion: EstadoDeAccion = EstadoDeAccion.LISTA,
    textoEnCurso: String = texto,
) = BotonConBorde(texto, alTocar, Tema.colores.error, modifier, accion, textoEnCurso)

@Composable
private fun BotonConBorde(
    texto: String,
    alTocar: () -> Unit,
    color: Color,
    modifier: Modifier,
    accion: EstadoDeAccion = EstadoDeAccion.LISTA,
    textoEnCurso: String = texto,
) {
    val cargando = accion.ocupada
    OutlinedButton(
        onClick = { if (!cargando) alTocar() },
        modifier = modifier.fillMaxWidth().heightIn(min = Tema.medidas.altoDeBoton).semantics { if (cargando) disabled() },
        shape = Tema.formas.boton,
        border = BorderStroke(Tema.medidas.bordeDeBoton, color),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Tema.colores.superficie, contentColor = color),
    ) {
        if (cargando) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = color)
        Text(if (cargando) textoEnCurso else texto, style = Tema.texto.boton, textAlign = TextAlign.Center, modifier = if (cargando) Modifier.padding(start = 10.dp) else Modifier)
    }
}

/** El botón naranja de cargar gasto, que flota sobre la barra de abajo. */
@Composable
fun BotonFlotante(texto: String, alTocar: () -> Unit, modifier: Modifier = Modifier) {
    Button(
        onClick = alTocar,
        modifier = modifier.heightIn(min = 60.dp),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(30.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Tema.colores.acento, contentColor = Tema.colores.superficie),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 6.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 30.dp),
    ) {
        Text("＋  $texto", style = Tema.texto.botonFlotante)
    }
}
