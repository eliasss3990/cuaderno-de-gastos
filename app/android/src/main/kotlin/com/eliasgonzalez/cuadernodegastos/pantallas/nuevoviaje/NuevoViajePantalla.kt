// El nuevo viaje en dos pasos: datos (1 de 2) y tope y efectivo (2 de 2). Cada paso vive en `partes/`.
package com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.IconoDeBarra
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.partes.PasoDatos
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.partes.PasoTope
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.partes.espacioDelPaso
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraSuperior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonPrincipal
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

/** Los toques de la pantalla. */
data class AccionesDeNuevoViaje(
    val alCerrar: () -> Unit = {},
    val alVolver: () -> Unit = {},
    val alCambiarNombre: (String) -> Unit = {},
    val alElegirInicio: (String?) -> Unit = {},
    val alElegirFin: (String?) -> Unit = {},
    val alCambiarSinFin: () -> Unit = {},
    val alCambiarMoneda: (String) -> Unit = {},
    val alAgregarMoneda: () -> Unit = {},
    val alCambiarApodo: (String) -> Unit = {},
    val alElegirEmoji: (Int) -> Unit = {},
    val alSeguir: () -> Unit = {},
    val alCambiarTope: (String, String) -> Unit = { _, _ -> },
    val alCambiarEfectivo: (String, String) -> Unit = { _, _ -> },
    val alCambiarObjetivos: (String) -> Unit = {},
    val alGuardar: () -> Unit = {},
)

/** Cuánto se sigue el final de la pantalla mientras el teclado se abre. */
internal const val seguimientoDelTeclado = 1200L

@Composable
fun NuevoViajePantalla(estado: NuevoViajeEstado, acciones: AccionesDeNuevoViaje) {
    var preguntarSiSale by remember { mutableStateOf(false) }
    // salir con algo cargado pregunta antes (con la ✕ o con el volver del sistema)
    val cerrar = { if (estado.cargoAlgo) preguntarSiSale = true else acciones.alCerrar() }
    // mientras se crea, volver no hace nada (el viaje puede quedar a medias)
    val volver = { if (!estado.enviando) acciones.alVolver() }
    BackHandler(onBack = if (estado.paso == 2) volver else cerrar)
    val desplazamiento = rememberScrollState()
    val alcance = rememberCoroutineScope()
    // en el último campo, que el botón de seguir también quede a la vista (también mientras el teclado se abre)
    val alFinal = {
        alcance.launch {
            // mientras el teclado se abre la pantalla se achica: se sigue al final hasta que se acomoda
            withTimeoutOrNull(seguimientoDelTeclado) { snapshotFlow { desplazamiento.maxValue }.collect { desplazamiento.scrollTo(it) } }
        }
        Unit
    }
    // con errores arriba (nombre o fechas) se vuelve al principio; los de abajo ya quedan a la vista
    LaunchedEffect(estado.errores) { if (estado.errores.keys.any { it == "nombre" || it == "fecha_fin" }) desplazamiento.animateScrollTo(0) }
    if (preguntarSiSale) {
        DialogoDeConfirmar(
            stringResource(R.string.nuevo_salir_titulo), stringResource(R.string.nuevo_salir_texto), stringResource(R.string.nuevo_seguir_cargando), stringResource(R.string.nuevo_salir),
            alSeguir = { preguntarSiSale = false }, alSalir = { preguntarSiSale = false; acciones.alCerrar() },
        )
    }
    // con el teclado abierto la pantalla se achica (imePadding) y se puede desplazar; tocar fuera de un campo lo cierra
    val foco = LocalFocusManager.current
    Column(
        Modifier.fillMaxSize().background(Tema.colores.fondo).systemBarsPadding().imePadding()
            .pointerInput(Unit) { detectTapGestures(onTap = { foco.clearFocus() }) },
    ) {
        if (estado.paso == 1) {
            BarraSuperior(stringResource(R.string.nuevo_titulo_1), icono = IconoDeBarra.CERRAR, alTocarIcono = cerrar)
        } else {
            BarraSuperior(stringResource(R.string.nuevo_titulo_2), icono = IconoDeBarra.VOLVER, alTocarIcono = volver)
        }
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(desplazamiento).padding(horizontal = Tema.espacios.l).padding(top = Tema.espacios.xs),
            verticalArrangement = Arrangement.spacedBy(espacioDelPaso),
        ) {
            if (estado.paso == 1) PasoDatos(estado, acciones, alEnfocarElUltimo = { alFinal() }) else PasoTope(estado, acciones)
            val mensaje = estado.problema ?: estado.mensaje?.let { stringResource(it) }
            mensaje?.let { Text(it, style = Tema.texto.aviso, color = Tema.colores.error, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
            if (estado.paso == 1) {
                BotonPrincipal(stringResource(R.string.nuevo_seguir), acciones.alSeguir)
            } else {
                BotonPrincipal(stringResource(if (estado.enviando) R.string.nuevo_creando else R.string.nuevo_guardar), acciones.alGuardar, habilitado = !estado.enviando, cargando = estado.enviando)
            }
            Spacer(Modifier.height(Tema.espacios.l))
        }
    }
}

@Preview(widthDp = 390, heightDp = 844)
@Composable
private fun Vista() = TemaCuaderno { NuevoViajePantalla(NuevoViajeEstado(nombre = "Brasil 2027"), AccionesDeNuevoViaje()) }
