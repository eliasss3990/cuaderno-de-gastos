// Unirse con un código: el código que te pasaron, tu apodo y tu emoji.
package com.eliasgonzalez.cuadernodegastos.pantallas.unirse

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.eliasgonzalez.cuadernodegastos.ui.componentes.dialogos.DialogoDeConfirmar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.seguimientoDelTeclado
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Perfiles
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.colorDe
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraSuperior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.IconoDeBarra
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonPrincipal
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.CampoDeTexto
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.estiloDelCodigo
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.separacionDeCampos
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.IconoRedondo
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.Tarjeta
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

/** Los toques de la pantalla. */
data class AccionesDeUnirse(
    val alCambiarCodigo: (String) -> Unit = {},
    val alCambiarApodo: (String) -> Unit = {},
    val alElegirEmoji: (Int) -> Unit = {},
    val alUnirse: () -> Unit = {},
    val alVolver: () -> Unit = {},
)

/** Cada emoji se toca en un círculo de 48 (área táctil mínima recomendada). */
private val tamanoDelEmoji = 48.dp

@Composable
fun UnirsePantalla(estado: UnirseEstado, acciones: AccionesDeUnirse) {
    var preguntarSiSale by remember { mutableStateOf(false) }
    // salir con algo cargado pregunta antes; mientras se une, volver no hace nada
    val volver = { if (!estado.enviando) { if (estado.cargoAlgo) preguntarSiSale = true else acciones.alVolver() } }
    BackHandler(onBack = volver)
    if (preguntarSiSale) {
        DialogoDeConfirmar(
            stringResource(R.string.unirse_salir_titulo), stringResource(R.string.nuevo_salir_texto), stringResource(R.string.nuevo_seguir_cargando), stringResource(R.string.nuevo_salir),
            alSeguir = { preguntarSiSale = false }, alSalir = { preguntarSiSale = false; acciones.alVolver() },
        )
    }
    val error = { campo: String -> estado.errores[campo] }
    val desplazamiento = rememberScrollState()
    val alcance = rememberCoroutineScope()
    // en el apodo, que el botón de unirse también quede a la vista (también mientras el teclado se abre)
    val alFinal = {
        alcance.launch {
            // mientras el teclado se abre la pantalla se achica: se sigue al final hasta que se acomoda
            withTimeoutOrNull(seguimientoDelTeclado) { snapshotFlow { desplazamiento.maxValue }.collect { desplazamiento.scrollTo(it) } }
        }
        Unit
    }
    // con el teclado abierto la pantalla se achica (imePadding) y se puede desplazar; tocar fuera de un campo lo cierra
    val foco = LocalFocusManager.current
    Column(
        Modifier.fillMaxSize().background(Tema.colores.fondo).systemBarsPadding().imePadding()
            .pointerInput(Unit) { detectTapGestures(onTap = { foco.clearFocus() }) },
    ) {
        BarraSuperior(stringResource(R.string.unirse_titulo), icono = IconoDeBarra.VOLVER, alTocarIcono = volver)
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(desplazamiento).padding(horizontal = Tema.espacios.l).padding(top = Tema.espacios.xs),
            verticalArrangement = Arrangement.spacedBy(separacionDeCampos),
        ) {
            Text(stringResource(R.string.unirse_explicacion), style = Tema.texto.cuerpo.copy(fontSize = 14.sp), color = Tema.colores.etiqueta)
            CampoDeTexto(
                stringResource(R.string.unirse_codigo), estado.codigo, acciones.alCambiarCodigo,
                teclado = KeyboardType.Ascii, estiloDelValor = estiloDelCodigo, ayuda = stringResource(R.string.unirse_codigo_ayuda),
                error = error("codigo")?.let { stringResource(it) }, soloMayusculas = true, accion = ImeAction.Next,
            )
            CampoDeTexto(
                stringResource(R.string.nuevo_apodo), estado.apodo, acciones.alCambiarApodo, ayuda = stringResource(R.string.nuevo_apodo_ayuda),
                error = error("apodo")?.let { stringResource(it) }, mayusculas = true, accion = ImeAction.Done, alEnfocar = alFinal, seguirAlTeclado = false,
            )
            Tarjeta(titulo = stringResource(R.string.nuevo_como_te_ven)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
                    Perfiles.emojis.forEachIndexed { i, e ->
                        IconoRedondo(e.emoji, colorDe(e.fondo), tamano = tamanoDelEmoji, marcado = i == estado.emoji, descripcion = stringResource(R.string.nuevo_emoji_descripcion, e.emoji)) { acciones.alElegirEmoji(i) }
                    }
                }
            }
            // un aviso general (sin conexión, viaje completo…): el lector de pantalla lo anuncia al aparecer
            estado.mensaje?.let {
                Text(
                    stringResource(it), style = Tema.texto.aviso, color = Tema.colores.error,
                    modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            BotonPrincipal(stringResource(R.string.unirse_boton), acciones.alUnirse, accion = estado.accion, textoEnCurso = stringResource(R.string.unirse_enviando))
            Spacer(Modifier.height(Tema.espacios.l))
        }
    }
}

@Preview(widthDp = 390, heightDp = 844)
@Composable
private fun Vista() = TemaCuaderno { UnirsePantalla(UnirseEstado(codigo = "K7M4-9XQ2", apodo = "Lu", emoji = 3), AccionesDeUnirse()) }
