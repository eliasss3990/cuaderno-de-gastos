// El nuevo viaje: junta los dos pasos, calcula lo que se muestra (aviso de inicio, días, promedio sugerido) y crea el
// viaje con el servicio, fuera del hilo principal.
package com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.base.ResultadoParseo
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.MonedaDelPlan
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Presupuesto
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Viaje
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Formatos
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Perfiles
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.mensajeDeFalla
import com.eliasgonzalez.cuadernodegastos.red.MonedaNueva
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.viajes.AltaDeViaje
import com.eliasgonzalez.cuadernodegastos.viajes.PlanNuevo
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Las monedas que se ofrecen al crear un viaje (las del viaje a Brasil, elegidas de entrada). */
val MONEDAS_DE_ENTRADA = listOf(Moneda("PYG", 0, "₲"), Moneda("BRL", 2, "R$"))

class NuevoViajeViewModel(
    private val crear: (PlanNuevo, Perfil) -> AltaDeViaje,
    private val nombreDelCelular: String,
    zonaDelCelular: String,
    private val alEntrar: (String) -> Unit,
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
    private val ahoraMs: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _estado = MutableStateFlow(
        calcular(NuevoViajeEstado(zona = zonaDelCelular, monedas = MONEDAS_DE_ENTRADA.map { MonedaElegible(it, Formatos.nombreDeMoneda(it.codigo), true) })),
    )
    val estado: StateFlow<NuevoViajeEstado> = _estado

    private fun cambiar(f: (NuevoViajeEstado) -> NuevoViajeEstado) {
        val antes = _estado.value
        val despues = f(antes)
        // un error se va cuando se toca su campo; los demás siguen a la vista hasta que se arreglen
        val errores = antes.errores.filterKeys { campo -> valorDe(antes, campo) == valorDe(despues, campo) }
        _estado.value = calcular(despues.copy(mensaje = null, problema = null, errores = errores))
    }

    private fun valorDe(e: NuevoViajeEstado, campo: String): Any? = when (campo) {
        "nombre" -> e.nombre
        "monedas" -> e.monedas
        "apodo" -> e.apodo
        "fecha_fin" -> e.fechaInicio to e.fechaFin
        else -> null
    }

    fun alCambiarNombre(n: String) = cambiar { it.copy(nombre = n) }

    fun alElegirInicio(f: String?) = cambiar { it.copy(fechaInicio = f) }

    fun alElegirFin(f: String?) = cambiar { it.copy(fechaFin = f, sinFechaFin = false) }

    fun alCambiarSinFin() = cambiar { it.copy(sinFechaFin = !it.sinFechaFin, fechaFin = if (!it.sinFechaFin) null else it.fechaFin) }

    fun alCambiarMoneda(codigo: String) = cambiar { e -> e.copy(monedas = e.monedas.map { if (it.moneda.codigo == codigo) it.copy(elegida = !it.elegida) else it }) }

    fun alCambiarApodo(a: String) = cambiar { it.copy(apodo = a) }

    fun alElegirEmoji(i: Int) = cambiar { it.copy(emoji = i) }

    fun alCambiarTope(codigo: String, texto: String) = cambiar { e -> e.copy(topes = e.topes + (codigo to Dinero.formatearEntrada(texto, monedaDe(e, codigo)))) }

    fun alCambiarEfectivo(codigo: String, texto: String) = cambiar { e -> e.copy(efectivo = e.efectivo + (codigo to Dinero.formatearEntrada(texto, monedaDe(e, codigo)))) }

    fun alCambiarObjetivos(o: String) = cambiar { it.copy(objetivos = o) }

    private fun monedaDe(e: NuevoViajeEstado, codigo: String) = e.monedas.first { it.moneda.codigo == codigo }.moneda

    /** Del paso 1 al 2, si lo obligatorio está. */
    fun alSeguir() {
        val e = _estado.value
        // todos los que faltan a la vez, cada uno en su campo (no de a uno)
        val errores = buildMap {
            if (e.nombre.isBlank()) put("nombre", R.string.nuevo_falta_nombre)
            if (e.fechaInicio != null && e.fechaFin != null && !e.sinFechaFin && e.fechaFin < e.fechaInicio) put("fecha_fin", R.string.nuevo_fechas_al_reves)
            if (e.monedas.none { it.elegida }) put("monedas", R.string.nuevo_falta_moneda)
            if (e.apodo.isBlank()) put("apodo", R.string.nuevo_falta_apodo)
        }
        _estado.value = if (errores.isNotEmpty()) e.copy(errores = errores) else e.copy(paso = 2, errores = emptyMap())
    }

    /** Del paso 2 al 1 (o, en el 1, nada: la pantalla cierra). Devuelve si se quedó en la pantalla. */
    fun alVolver(): Boolean {
        if (_estado.value.paso == 1) return false
        _estado.value = _estado.value.copy(paso = 1)
        return true
    }

    private fun montos(textos: Map<String, String>, e: NuevoViajeEstado): Map<String, Long?> =
        e.monedas.filter { it.elegida }.associate { m ->
            m.moneda.codigo to (Dinero.parsear(textos[m.moneda.codigo].orEmpty(), m.moneda) as? ResultadoParseo.Ok)?.minor
        }

    fun alGuardar() {
        val e = _estado.value
        if (e.enviando) return
        val elegidas = e.monedas.filter { it.elegida }.map { it.moneda }
        val plan = PlanNuevo(
            nombre = e.nombre.trim(),
            zonaHoraria = e.zona,
            monedas = elegidas.map { MonedaNueva(it.codigo, it.decimales, it.simbolo) },
            fechaInicio = e.fechaInicio,
            fechaFin = if (e.sinFechaFin) null else e.fechaFin,
            topes = montos(e.topes, e),
            efectivoInicial = montos(e.efectivo, e),
            objetivos = e.objetivos.trim().ifEmpty { null },
        )
        val emoji = Perfiles.emojis[e.emoji]
        val perfil = Perfil(nombreDelCelular, e.apodo.trim(), Perfiles.colores[e.emoji % Perfiles.colores.size], emoji.emoji)
        _estado.value = e.copy(enviando = true, mensaje = null, problema = null)
        viewModelScope.launch {
            val r = withContext(hilo) { crear(plan, perfil) }
            when (r) {
                is AltaDeViaje.Lista -> alEntrar(r.viaje)
                // el viaje existe: se entra igual y el plan se completa desde el viaje
                is AltaDeViaje.SinPlan -> {
                    _estado.value = _estado.value.copy(enviando = false, mensaje = R.string.nuevo_sin_plan)
                    alEntrar(r.viaje)
                }
                is AltaDeViaje.PlanInvalido -> _estado.value = _estado.value.copy(enviando = false, problema = r.mensaje)
                is AltaDeViaje.Fallo -> _estado.value = _estado.value.copy(enviando = false, mensaje = mensajeDeFalla(r.motivo))
                is AltaDeViaje.YaEstaba -> alEntrar(r.viaje)
            }
        }
    }

    /** Lo que se deriva de lo cargado: cuándo arranca, la ciudad del horario, los días y el promedio sugerido. */
    private fun calcular(e: NuevoViajeEstado): NuevoViajeEstado {
        val hoy = runCatching { com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje.diaEn(ahoraMs(), e.zona) }.getOrNull()
        val arranque = when {
            e.fechaInicio == null -> Arranque.SIN_SALIDA
            hoy == null || e.fechaInicio > hoy -> Arranque.FALTA
            e.fechaInicio == hoy -> Arranque.HOY
            else -> Arranque.YA_ARRANCO
        }
        val fin = if (e.sinFechaFin) null else e.fechaFin
        val viaje = Viaje("nuevo", e.nombre, e.zona, e.fechaInicio, fin, null, null)
        val dias = Presupuesto.diasDelViaje(viaje)?.takeIf { it > 0 }
        val topes = montos(e.topes, e)
        val promedios = if (dias == null) emptyList() else e.monedas.filter { it.elegida }.mapNotNull { m ->
            val tope = topes[m.moneda.codigo] ?: return@mapNotNull null
            val p = Presupuesto.calcular(viaje, MonedaDelPlan(m.moneda, true, tope, null), emptyList(), emptyList(), e.fechaInicio ?: return@mapNotNull null)
            val promedio = p.promedioDiarioMinor ?: return@mapNotNull null
            PromedioSugerido(m.moneda, Dinero.formatear(promedio, m.moneda), "${Dinero.formatearNumero(tope, m.moneda.decimales)} ÷ $dias")
        }
        return e.copy(arranque = arranque, salidaParaLeer = e.fechaInicio?.let(Formatos::fechaLarga).orEmpty(), ciudad = Formatos.ciudad(e.zona), dias = dias, promedios = promedios)
    }
}
