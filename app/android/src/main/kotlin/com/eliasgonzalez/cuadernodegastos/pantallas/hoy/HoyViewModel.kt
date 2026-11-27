// Hoy se vuelve a armar cada vez que la sincronización avisa un cambio (y cada minuto, por si cambió el día).
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.ResumenDeHoy
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class HoyViewModel(
    /** El resumen de hoy (bloquea: se lee en `hilo`). */
    private val resumen: () -> ResumenDeHoy?,
    private val pendientes: () -> Int,
    cambios: Flow<Long>,
    estado: Flow<EstadoDeSincronizacion?>,
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
    /** Deshace el alta de un gasto recién guardado (bloquea); null si no se pudo (el viaje ya no está vinculado). */
    private val deshacerAlta: (String) -> Resultado? = { null },
    /** Cuánto se ve un aviso: 4 s, o más si la accesibilidad del celular lo pide (lector de pantalla, tiempos más largos). */
    private val duracionDelAviso: Long = DURACION_DEL_AVISO,
    reloj: Flow<Unit> = flow {
        while (true) {
            emit(Unit)
            delay(60_000)
        }
    },
) : ViewModel() {
    val estado: StateFlow<HoyEstado> = combine(cambios, estado, reloj) { _, e, _ -> e }
        // si leer la base falla (bloqueada, migración a medias) no se cae la app: queda como cargando y se reintenta con el próximo aviso
        .map { e -> runCatching { resumen()?.let { ArmadoDeHoy.armar(it, e, pendientes()) } }.getOrNull() ?: HoyEstado() }
        .flowOn(hilo)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HoyEstado())

    private val _aviso = MutableStateFlow<AvisoDeHoy?>(null)

    /** El aviso breve de abajo (gasto guardado con deshacer, o cómo terminó el deshacer), o null. */
    val aviso: StateFlow<AvisoDeHoy?> = _aviso
    private var vencimiento: Job? = null

    private fun mostrar(a: AvisoDeHoy) {
        vencimiento?.cancel()
        _aviso.value = a
        vencimiento = viewModelScope.launch {
            delay(duracionDelAviso)
            _aviso.value = null
        }
    }

    /** Se acaba de guardar un gasto (en otra pantalla): aviso con deshacer. Queda acá, aunque la pantalla gire. */
    fun alGuardarGasto(gastoId: String, monto: String, otroDia: String? = null) = mostrar(AvisoDeHoy.Guardado(gastoId, monto, otroDia))

    /** Deshace el gasto del aviso; el aviso dice si se pudo. */
    fun alDeshacer() {
        val guardado = _aviso.value as? AvisoDeHoy.Guardado ?: return
        vencimiento?.cancel()
        _aviso.value = null
        viewModelScope.launch {
            val r = withContext(hilo) {
                try {
                    deshacerAlta(guardado.gastoId)
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
            }
            mostrar(if (r is Resultado.Aceptada || r == Resultado.Duplicada) AvisoDeHoy.Deshecho(guardado.monto) else AvisoDeHoy.NoSePudoDeshacer)
        }
    }

    companion object {
        /** Cuánto se ve un aviso. */
        const val DURACION_DEL_AVISO = 4_000L
    }
}

/** El aviso breve de Hoy. */
sealed interface AvisoDeHoy {
    /** [otroDia]: el día del gasto si no es hoy (no se ve en Hoy, el aviso lo nombra). */
    data class Guardado(val gastoId: String, val monto: String, val otroDia: String? = null) : AvisoDeHoy

    data class Deshecho(val monto: String) : AvisoDeHoy

    data object NoSePudoDeshacer : AvisoDeHoy
}
