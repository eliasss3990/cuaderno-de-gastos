// La lista de gastos se vuelve a armar cada vez que la sincronización avisa un cambio.
package com.eliasgonzalez.cuadernodegastos.pantallas.gastos

import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.ListaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class GastosViewModel(
    /** El lector del viaje (bloquea: se usa en `hilo`). */
    private val lector: () -> LectorDelViaje,
    private val pendientes: () -> Int,
    cambios: Flow<Long>,
    estado: Flow<EstadoDeSincronizacion?>,
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
    private val ahoraMs: () -> Long = System::currentTimeMillis,
    /** Con qué arranca mientras lee (lo último que se vio, si hay). */
    inicial: GastosEstado = GastosEstado(),
) : ViewModel() {
    val estado: StateFlow<GastosEstado> = combine(cambios, estado) { _, e -> e }
        // si leer la base falla no se cae la app: lo dice, y se vuelve a leer con el próximo cambio
        .map { e ->
            runCatching {
                val l = lector()
                // el viaje todavía no está (no bajó su alta): se espera, no es un error de lectura
                if (l.viaje() == null) return@runCatching GastosEstado()
                ListaDeGastos.armar(l)?.let {
                    val hoy = EstadoDelViaje.diaEn(ahoraMs(), it.viaje.zonaHoraria)
                    ArmadoDeGastos.armar(it, l.monedas().associate { m -> m.moneda.codigo to m.moneda }, e, pendientes(), hoy)
                }
            }.getOrNull() ?: GastosEstado(cargando = false, noSePudoLeer = true)
        }
        .flowOn(hilo)
        // sigue al día aunque otra pantalla la tape (al volver no muestra un instante lo viejo y después salta)
        .stateIn(viewModelScope, SharingStarted.Eagerly, inicial)
}
