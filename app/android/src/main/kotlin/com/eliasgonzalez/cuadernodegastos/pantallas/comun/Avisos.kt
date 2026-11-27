// El aviso breve de abajo de Hoy y de Gastos: un gasto guardado o enviado a la papelera, con deshacer, y cómo terminó.
package com.eliasgonzalez.cuadernodegastos.pantallas.comun

import kotlinx.coroutines.Dispatchers
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.ViewModel
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.AvisoBreve
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface AvisoDeGastos {
    /** [otroDia]: el día del gasto si no es hoy (no se ve en Hoy, el aviso lo nombra). */
    data class Guardado(val gastoId: String, val monto: String, val otroDia: String? = null) : AvisoDeGastos

    data class Deshecho(val monto: String) : AvisoDeGastos

    data object NoSePudoDeshacer : AvisoDeGastos

    data class EnPapelera(val gastoId: String, val monto: String) : AvisoDeGastos

    data class Restaurado(val monto: String) : AvisoDeGastos

    data object NoSePudoRestaurar : AvisoDeGastos
}

/** Lleva el aviso de una pantalla: lo muestra un rato y, si tiene deshacer, lo deshace fuera del hilo principal. */
class ControlDeAvisos(
    private val alcance: CoroutineScope,
    private val hilo: CoroutineDispatcher,
    private val duracion: Long,
    /** Deshace el alta de un gasto recién guardado (bloquea); null si no se pudo. */
    private val deshacerAlta: (String) -> Resultado?,
    /** Saca un gasto de la papelera (bloquea); null si no se pudo. */
    private val restaurar: (String) -> Resultado?,
) {
    private val _aviso = MutableStateFlow<AvisoDeGastos?>(null)
    val aviso: StateFlow<AvisoDeGastos?> = _aviso
    private var vencimiento: Job? = null

    fun mostrar(a: AvisoDeGastos) {
        vencimiento?.cancel()
        _aviso.value = a
        vencimiento = alcance.launch {
            delay(duracion)
            _aviso.value = null
        }
    }

    /** Deshace lo del aviso (si tiene deshacer); el aviso nuevo dice si se pudo. */
    fun alDeshacer() {
        val a = _aviso.value
        val (id, monto, accion) = when (a) {
            is AvisoDeGastos.Guardado -> Triple(a.gastoId, a.monto, deshacerAlta)
            is AvisoDeGastos.EnPapelera -> Triple(a.gastoId, a.monto, restaurar)
            else -> return
        }
        vencimiento?.cancel()
        _aviso.value = null
        alcance.launch {
            val r = withContext(hilo) {
                try {
                    accion(id)
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
            }
            val bien = r is Resultado.Aceptada || r == Resultado.Duplicada
            // si mientras tanto apareció otro aviso (con su propio deshacer), un éxito no lo tapa; un fallo sí se avisa
            if (_aviso.value != null && bien) return@launch
            mostrar(
                when (a) {
                    is AvisoDeGastos.Guardado -> if (bien) AvisoDeGastos.Deshecho(monto) else AvisoDeGastos.NoSePudoDeshacer
                    is AvisoDeGastos.EnPapelera -> if (bien) AvisoDeGastos.Restaurado(monto) else AvisoDeGastos.NoSePudoRestaurar
                    else -> return@launch
                },
            )
        }
    }

    companion object {
        /** Cuánto se ve un aviso. */
        const val DURACION = 4_000L
    }
}

/**
 * El aviso de toda la app (uno solo, por encima de las pantallas): lo pone quien guarda o manda a la papelera, y lo
 * muestran Hoy y Gastos. Así no se pierde al pasar de una a otra.
 */
class AvisosViewModel(
    /** Deshace el alta de un gasto del viaje (bloquea); null si no se pudo. */
    deshacerAlta: (viaje: String, gasto: String) -> Resultado?,
    /** Saca un gasto del viaje de la papelera (bloquea); null si no se pudo. */
    restaurar: (viaje: String, gasto: String) -> Resultado?,
    duracion: Long = ControlDeAvisos.DURACION,
    hilo: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private var viaje = ""
    private val control = ControlDeAvisos(viewModelScope, hilo, duracion, { deshacerAlta(viaje, it) }, { restaurar(viaje, it) })
    val aviso: StateFlow<AvisoDeGastos?> = control.aviso

    fun mostrar(viaje: String, a: AvisoDeGastos) {
        this.viaje = viaje
        control.mostrar(a)
    }

    fun alDeshacer() = control.alDeshacer()
}

/** El aviso dibujado: aparece desde abajo y se desvanece (el último texto se sigue viendo mientras se va). */
@Composable
fun AvisoDeAbajo(aviso: AvisoDeGastos?, alDeshacer: () -> Unit, modifier: Modifier = Modifier) {
    val texto = when (aviso) {
        is AvisoDeGastos.Guardado -> aviso.otroDia?.let { stringResource(R.string.hoy_gasto_guardado_otro_dia, aviso.monto, diaParaLeer(it)) }
            ?: stringResource(R.string.hoy_gasto_guardado, aviso.monto)
        is AvisoDeGastos.Deshecho -> stringResource(R.string.hoy_gasto_deshecho, aviso.monto)
        AvisoDeGastos.NoSePudoDeshacer -> stringResource(R.string.hoy_no_se_pudo_deshacer)
        is AvisoDeGastos.EnPapelera -> stringResource(R.string.gastos_en_papelera, aviso.monto)
        is AvisoDeGastos.Restaurado -> stringResource(R.string.gastos_restaurado, aviso.monto)
        AvisoDeGastos.NoSePudoRestaurar -> stringResource(R.string.gastos_no_se_pudo_restaurar)
        null -> null
    }
    var ultimoTexto by remember { mutableStateOf<String?>(null) }
    var ultimo by remember { mutableStateOf<AvisoDeGastos?>(null) }
    if (texto != null) {
        ultimoTexto = texto
        ultimo = aviso
    }
    AnimatedVisibility(visible = texto != null, modifier = modifier, enter = fadeIn() + slideInVertically { it / 2 }, exit = fadeOut()) {
        ultimoTexto?.let {
            val conDeshacer = ultimo is AvisoDeGastos.Guardado || ultimo is AvisoDeGastos.EnPapelera
            AvisoBreve(
                it, accion = if (conDeshacer) stringResource(R.string.hoy_deshacer) else null, alTocarAccion = alDeshacer,
                salioMal = ultimo == AvisoDeGastos.NoSePudoDeshacer || ultimo == AvisoDeGastos.NoSePudoRestaurar,
            )
        }
    }
}

/** "jueves 26 de febrero" (puede ser un pago previo, de otro mes). */
fun diaParaLeer(dia: String): String =
    java.time.LocalDate.parse(dia).dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.forLanguageTag("es")) + " " + Formatos.fechaLarga(dia)
