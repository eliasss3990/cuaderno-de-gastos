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
import kotlinx.coroutines.launch

class HoyViewModel(
    /** El resumen de hoy (bloquea: se lee en `hilo`). */
    private val resumen: () -> ResumenDeHoy?,
    private val pendientes: () -> Int,
    cambios: Flow<Long>,
    estado: Flow<EstadoDeSincronizacion?>,
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
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
        // sigue al día aunque otra pantalla la tape (al volver no muestra un instante lo viejo y después salta)
        .stateIn(viewModelScope, SharingStarted.Eagerly, HoyEstado())
}
