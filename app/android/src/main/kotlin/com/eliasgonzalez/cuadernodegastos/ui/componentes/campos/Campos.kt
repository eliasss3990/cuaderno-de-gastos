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
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
                .border(BorderStroke(if (error != null || resaltado) 2.dp else 1.dp, borde), Tema.formas.campo)
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
    /** Lo que admite el dato: lo de más no se escribe. */
    largoMaximo: Int? = null,
    /** Que la pantalla siga al campo mientras se abre el teclado (false si quien lo usa ya se ocupa). */
    seguirAlTeclado: Boolean = true,
) {
    val foco = LocalFocusManager.current
    // con el foco, el borde se marca (como un campo de Material): se ve dónde se está escribiendo
    val fuente = remember { MutableInteractionSource() }
    val enfocado by fuente.collectIsFocusedAsState()
    // al tomar el foco, la pantalla sigue al campo mientras se abre el teclado hasta dejarlo a la vista (en toda la app)
    val aLaVista = remember { BringIntoViewRequester() }
    val tecladoDelSistema = WindowInsets.ime
    val densidad = LocalDensity.current
    LaunchedEffect(enfocado) {
        if (enfocado && seguirAlTeclado) withTimeoutOrNull(1_200) { snapshotFlow { tecladoDelSistema.getBottom(densidad) }.collect { aLaVista.bringIntoView() } }
    }
    // si quien usa el campo reformatea lo escrito (por ejemplo, el punto de miles de un monto), el cursor queda al final;
    // si no lo cambia, se respeta dónde estaba
    var edicion by remember { mutableStateOf(TextFieldValue(valor, TextRange(valor.length))) }
    val enEdicion = if (edicion.text == valor) edicion else TextFieldValue(valor, TextRange(valor.length))
    Caja(etiqueta, resaltado || enfocado, error, modifier.bringIntoViewRequester(aLaVista), null) {
        BasicTextField(
            // "Siguiente" baja al campo de abajo; "Listo" suelta el campo y cierra el teclado
            keyboardActions = KeyboardActions(
                onNext = { if (alSiguiente != null) { foco.clearFocus(); alSiguiente() } else foco.moveFocus(FocusDirection.Down) },
                onDone = { foco.clearFocus() },
            ),
            value = enEdicion,
            onValueChange = {
                // lo de más no se escribe: la edición guarda lo mismo que sube (si no, cada tecla movería el cursor)
                val recortado = if (largoMaximo != null && it.text.length > largoMaximo) {
                    // se descarta lo que sobra de lo recién escrito (justo antes del cursor), no el final del texto
                    val sobra = it.text.length - largoMaximo
                    val fin = it.selection.end.coerceIn(sobra, it.text.length)
                    // sin partir un emoji (dos unidades): si el corte cae en el medio, se quita entero
                    val desde = if (fin - sobra > 0 && it.text[fin - sobra - 1].isHighSurrogate()) fin - sobra - 1 else fin - sobra
                    it.copy(text = it.text.removeRange(desde, fin), selection = TextRange(desde))
                } else {
                    it
                }
                edicion = recortado
                alCambiar(recortado.text)
            },
            singleLine = unaLinea,
            interactionSource = fuente,
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
    // al elegir, se suelta el campo de texto que tuviera el foco: si no, al cerrarse el calendario Android se lo devuelve
    // y vuelve a abrir el teclado
    val foco = LocalFocusManager.current
    Caja(
        etiqueta,
        false,
        error,
        modifier,
        icono?.takeIf { habilitado }?.let { { Icon(it, contentDescription = null, tint = Tema.colores.etiqueta, modifier = Modifier.padding(start = Tema.espacios.s)) } },
        habilitado = habilitado,
        alTocar = { foco.clearFocus(force = true); alTocar() },
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
