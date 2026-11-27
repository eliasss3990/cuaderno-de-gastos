// El detalle de un gasto se vuelve a armar con cada cambio (otro celular puede editarlo mientras se mira).
package com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto

import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.EstadoDeAccion
import kotlinx.coroutines.flow.combine
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.ListaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DetalleViewModel(
    /** El lector del viaje (bloquea: se usa en `hilo`). */
    private val lector: () -> LectorDelViaje,
    private val gastoId: String,
    cambios: Flow<Long>,
    /** Manda el gasto a la papelera (bloquea); null si no se pudo (el viaje ya no está vinculado). */
    private val aLaPapelera: (String) -> Resultado?,
    /** Lo saca de la papelera (bloquea); null si no se pudo. */
    private val restaurar: (String) -> Resultado? = { null },
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    /** Se mandó a la papelera: la pantalla vuelve y la de abajo avisa con deshacer (id y monto). */
    private val _enviado = MutableStateFlow<Pair<String, String>?>(null)
    val enviado: StateFlow<Pair<String, String>?> = _enviado

    private val _saliendo = MutableStateFlow(false)
    private var ultimoActivo: DetalleEstado? = null

    val estado: StateFlow<DetalleEstado> = cambios
        .map {
            runCatching {
                val l = lector()
                // el viaje todavía no está: se espera (no es un error de lectura)
                val viaje = l.viaje() ?: return@runCatching DetalleEstado()
                ListaDeGastos.detalle(l, gastoId)?.let { g -> ArmadoDeDetalle.armar(g, l.monedas().associate { m -> m.moneda.codigo to m.moneda }, viaje.zonaHoraria) }
                    ?: DetalleEstado(cargando = false, noExiste = true)
            }.getOrNull() ?: DetalleEstado(cargando = false, noSePudoLeer = true)
        }
        .flowOn(hilo)
        // saliendo tras mandarlo a la papelera, se ve el último estado anterior (no "en la papelera" mientras se va);
        // si al final no salió, vuelve a verse lo real (combinar, no filtrar: nada se pierde)
        .combine(_saliendo) { e, saliendo -> if (!e.enPapelera) e.also { ultimoActivo = it } else if (saliendo) ultimoActivo ?: e else e }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DetalleEstado())

    private val _accion = MutableStateFlow(EstadoDeAccion.LISTA)

    /** Papelera o restaurar: mandar a la papelera termina en HECHA (la pantalla se va); restaurar vuelve a LISTA. */
    val accion: StateFlow<EstadoDeAccion> = _accion


    private val _fallo = MutableStateFlow<FalloDeDetalle?>(null)

    /** No se pudo mandar a la papelera: se avisa en la pantalla. */
    val fallo: StateFlow<FalloDeDetalle?> = _fallo

    /** Restaurar un gasto que está en la papelera: vuelve a verse como cualquier otro (la pantalla se actualiza sola). */
    fun alRestaurar() {
        if (_accion.value.ocupada) return
        _accion.value = EstadoDeAccion.EN_CURSO
        _fallo.value = null
        viewModelScope.launch {
            val r = withContext(hilo) {
                try {
                    restaurar(gastoId)
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
            }
            // restaurado, el gasto queda en esta pantalla: el botón vuelve a estar listo
            _accion.value = EstadoDeAccion.LISTA
            if (!(r is Resultado.Aceptada || r == Resultado.Duplicada)) _fallo.value = FalloDeDetalle.RESTAURAR
        }
    }

    fun alEnviarAPapelera() {
        if (_accion.value.ocupada) return
        // desde ya se sale: el estado "en papelera" que llega al registrar no se dibuja
        _saliendo.value = true
        val monto = estado.value.monto
        _accion.value = EstadoDeAccion.EN_CURSO
        _fallo.value = null
        viewModelScope.launch {
            val r = withContext(hilo) {
                try {
                    aLaPapelera(gastoId)
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
            }
            if (r is Resultado.Aceptada || r == Resultado.Duplicada) {
                _accion.value = EstadoDeAccion.HECHA
                _enviado.value = gastoId to monto
            } else {
                _accion.value = EstadoDeAccion.LISTA
                _saliendo.value = false
                _fallo.value = FalloDeDetalle.PAPELERA
            }
        }
    }
}

/** Qué acción falló: el aviso se muestra solo si sigue teniendo sentido (otro celular pudo haberlo hecho igual). */
enum class FalloDeDetalle { PAPELERA, RESTAURAR }
