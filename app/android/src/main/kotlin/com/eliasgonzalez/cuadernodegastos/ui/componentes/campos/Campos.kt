// Los campos: la etiqueta arriba, el dato abajo en una caja blanca de al menos 56 de alto; vacío, un texto de ayuda gris;
// con error, el borde y un mensaje en rojo debajo.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.campos

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

@Composable
private fun Caja(
    etiqueta: String,
    resaltado: Boolean,
    error: String?,
    modifier: Modifier,
    derecha: (@Composable () -> Unit)?,
    habilitado: Boolean = true,
    alTocar: (() -> Unit)? = null,
    contenido: @Composable () -> Unit,
) {
    val borde = when {
        error != null -> Tema.colores.error
        resaltado -> Tema.colores.principal
        !habilitado -> Tema.colores.linea
        else -> Tema.colores.bordeDeCampo
    }
    Column(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clip(Tema.formas.campo)
                .let { if (alTocar != null) it.clickable(enabled = habilitado, role = Role.Button, onClickLabel = etiqueta, onClick = alTocar) else it }
                .background(if (habilitado) Tema.colores.superficie else Tema.colores.pista, Tema.formas.campo)
                .border(BorderStroke(if (error != null) 2.dp else 1.dp, borde), Tema.formas.campo)
                .padding(horizontal = Tema.espacios.m, vertical = Tema.espacios.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(etiqueta, style = Tema.texto.etiqueta, color = if (error != null) Tema.colores.error else Tema.colores.etiqueta)
                contenido()
            }
            derecha?.invoke()
        }
        if (error != null) Text(error, style = Tema.texto.error, color = Tema.colores.error, modifier = Modifier.padding(start = Tema.espacios.m, top = Tema.espacios.xs))
    }
}

/** Un campo que se escribe. `ayuda` se ve gris mientras está vacío. */
@Composable
fun CampoDeTexto(
    etiqueta: String,
    valor: String,
    alCambiar: (String) -> Unit,
    modifier: Modifier = Modifier,
    teclado: KeyboardType = KeyboardType.Text,
    estiloDelValor: TextStyle = Tema.texto.valorDeCampo,
    resaltado: Boolean = false,
    /** Algo que va antes del texto (por ejemplo, el emoji del apodo). */
    prefijo: (@Composable () -> Unit)? = null,
    unaLinea: Boolean = true,
    ayuda: String? = null,
    error: String? = null,
    /** Nombres propios: cada palabra arranca en mayúscula. */
    mayusculas: Boolean = false,
    /** Todo en mayúsculas y sin autocorrección (un código). */
    soloMayusculas: Boolean = false,
    accion: ImeAction = ImeAction.Default,
    lineasMinimas: Int = 1,
    /** Al tomar el foco (por ejemplo, para mostrar también el botón de abajo). */
    alEnfocar: () -> Unit = {},
    /** Qué hace "Siguiente" del teclado si lo que sigue no es otro campo de texto (por ejemplo, abrir un calendario). */
    alSiguiente: (() -> Unit)? = null,
    /** Para darle el foco desde afuera. */
    pedidoDeFoco: FocusRequester? = null,
) {
    val foco = LocalFocusManager.current
    Caja(etiqueta, resaltado, error, modifier, null) {
        BasicTextField(
            // "Siguiente" baja al campo de abajo; "Listo" suelta el campo y cierra el teclado
            keyboardActions = KeyboardActions(
                onNext = { if (alSiguiente != null) { foco.clearFocus(); alSiguiente() } else foco.moveFocus(FocusDirection.Down) },
                onDone = { foco.clearFocus() },
            ),
            value = valor,
            onValueChange = alCambiar,
            singleLine = unaLinea,
            minLines = lineasMinimas,
            decorationBox = { campo ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    prefijo?.invoke()
                    Box(Modifier.weight(1f)) {
                        // la ayuda con el espaciado normal aunque el dato vaya espaciado (un código)
                        if (valor.isEmpty() && ayuda != null) Text(ayuda, style = estiloDelValor.copy(letterSpacing = Tema.texto.valorDeCampo.letterSpacing), color = Tema.colores.ayuda)
                        campo()
                    }
                }
            },
            textStyle = estiloDelValor.copy(color = Tema.colores.dato),
            cursorBrush = SolidColor(Tema.colores.principal),
            keyboardOptions = KeyboardOptions(
                keyboardType = teclado,
                capitalization = when {
                    soloMayusculas -> KeyboardCapitalization.Characters
                    mayusculas -> KeyboardCapitalization.Words
                    else -> KeyboardCapitalization.Sentences
                },
                autoCorrectEnabled = !soloMayusculas,
                imeAction = accion,
            ),
            modifier = Modifier.fillMaxWidth().let { m -> pedidoDeFoco?.let { m.focusRequester(it) } ?: m }.onFocusChanged { if (it.isFocused) alEnfocar() },
        )
    }
}

/**
 * Un campo que se toca para elegir (una fecha); `valor` null muestra `ayuda` en gris. `icono` a la derecha dice que se
 * toca; `aclaracion` va chica y gris después del valor.
 */
@Composable
fun CampoParaElegir(
    etiqueta: String,
    valor: String?,
    alTocar: () -> Unit,
    modifier: Modifier = Modifier,
    ayuda: String = "",
    icono: ImageVector? = null,
    aclaracion: String? = null,
    error: String? = null,
    habilitado: Boolean = true,
) {
    Caja(
        etiqueta,
        false,
        error,
        modifier,
        icono?.takeIf { habilitado }?.let { { Icon(it, contentDescription = null, tint = Tema.colores.etiqueta, modifier = Modifier.padding(start = Tema.espacios.s)) } },
        habilitado = habilitado,
        alTocar = alTocar,
    ) {
        if (valor == null) {
            Text(ayuda, style = Tema.texto.valorDeCampo, color = Tema.colores.ayuda)
        } else {
            Text(
                buildAnnotatedString {
                    append(valor)
                    if (aclaracion != null) withStyle(SpanStyle(fontSize = Tema.texto.chico.fontSize, color = Tema.colores.apagado)) { append(" $aclaracion") }
                },
                style = Tema.texto.valorDeCampo,
                color = if (habilitado) Tema.colores.dato else Tema.colores.etiqueta,
            )
        }
    }
}

/** El espacio entre un campo y el siguiente. */
val separacionDeCampos = 12.dp

/** El tamaño del código de invitación (más grande y espaciado, para dictarlo). */
val estiloDelCodigo = TextStyle(fontSize = 22.sp, letterSpacing = 3.sp)
