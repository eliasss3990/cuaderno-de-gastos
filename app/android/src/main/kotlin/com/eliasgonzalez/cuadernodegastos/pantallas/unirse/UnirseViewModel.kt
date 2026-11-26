// Unirse con un código: valida lo mínimo en la pantalla y deja el resto al servicio (fuera del hilo principal).
package com.eliasgonzalez.cuadernodegastos.pantallas.unirse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Perfiles
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.mensajeDeFalla
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.viajes.AltaDeViaje
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class UnirseViewModel(
    private val unirse: (String, Perfil) -> AltaDeViaje,
    private val nombreDelCelular: String,
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val _estado = MutableStateFlow(UnirseEstado())
    val estado: StateFlow<UnirseEstado> = _estado

    // el código se muestra en mayúsculas (el servidor también acepta minúsculas y sin guion)
    fun alCambiarCodigo(c: String) = _estado.update { it.copy(codigo = c.uppercase().filterNot { it.isWhitespace() }, errores = it.errores - "codigo", mensaje = null) }

    fun alCambiarApodo(a: String) = _estado.update { it.copy(apodo = a, errores = it.errores - "apodo", mensaje = null) }

    fun alElegirEmoji(i: Int) = _estado.update { it.copy(emoji = i) }

    fun alUnirse() {
        val e = _estado.value
        if (e.enviando) return
        // todo lo que falta a la vez, cada uno en su campo
        val faltan = buildMap {
            if (e.codigo.isBlank()) put("codigo", R.string.unirse_falta_codigo)
            if (e.apodo.isBlank()) put("apodo", R.string.unirse_falta_nombre)
        }
        if (faltan.isNotEmpty()) return _estado.update { it.copy(errores = faltan, mensaje = null) }
        _estado.update { it.copy(enviando = true, errores = emptyMap(), mensaje = null) }
        // el color sale del emoji, como al crear el viaje
        val perfil = Perfil(nombreDelCelular, e.apodo.trim(), Perfiles.colores[e.emoji % Perfiles.colores.size], Perfiles.emojis[e.emoji].emoji)
        viewModelScope.launch {
            val r = withContext(hilo) { unirse(e.codigo, perfil) }
            when (r) {
                is AltaDeViaje.Lista -> _estado.update { it.copy(entrarA = r.viaje) }
                // ya estaba en el celular: se entra sin más (un aviso acá no se llegaría a leer)
                is AltaDeViaje.YaEstaba -> _estado.update { it.copy(entrarA = r.viaje) }
                is AltaDeViaje.Fallo -> {
                    val m = mensajeDeFalla(r.motivo)
                    // el código que no sirve se marca en su campo; lo demás es un aviso general
                    _estado.update {
                        if (m == R.string.alta_codigo_invalido) it.copy(enviando = false, errores = mapOf("codigo" to m)) else it.copy(enviando = false, mensaje = m)
                    }
                }
                // unirse no devuelve esos, pero si algún día lo hiciera no queda trabado
                is AltaDeViaje.SinPlan, is AltaDeViaje.PlanInvalido -> _estado.update { it.copy(enviando = false, mensaje = R.string.alta_rechazada) }
            }
        }
    }
}
