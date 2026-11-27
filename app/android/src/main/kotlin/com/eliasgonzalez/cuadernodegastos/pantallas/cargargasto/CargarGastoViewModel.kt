// Cargar un gasto: arma el formulario con los valores por defecto, va formateando el monto y registra el alta fuera del
// hilo principal; lo que decide qué viaja está en CargaDeGastos (dominio).
package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto

import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje
import com.eliasgonzalez.cuadernodegastos.sincronizacion.ViajeNoVinculado
import com.eliasgonzalez.cuadernodegastos.dominio.base.Ids
import com.eliasgonzalez.cuadernodegastos.dominio.base.ResultadoParseo
import com.eliasgonzalez.cuadernodegastos.dominio.gastos.BorradorDeGasto
import com.eliasgonzalez.cuadernodegastos.dominio.gastos.CargaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Razon
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Formatos
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Los métodos de pago, en el orden en que se ofrecen. */
val METODOS_DE_PAGO = listOf(
    OpcionDePago("EFECTIVO", "Efectivo"),
    OpcionDePago("CREDITO", "Crédito"),
    OpcionDePago("DEBITO", "Débito"),
    OpcionDePago("PIX", "Pix"),
    OpcionDePago("TRANSFERENCIA", "Transferencia o QR"),
    OpcionDePago("OTRO", "Otro"),
)

class CargarGastoViewModel(
    /** El lector del viaje (bloquea: se usa en `hilo`). */
    private val lector: () -> LectorDelViaje,
    /** Quién soy en el viaje, o null si no se sabe. */
    private val yo: () -> String?,
    /** Registra el alta con el id del gasto y de la operación (bloquea); lanza ViajeNoVinculado si el viaje ya no está. */
    private val registrar: (BorradorDeGasto, String, String) -> Resultado,
    private val nuevoId: () -> String = { Ids.nuevo() },
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
    private val ahoraMs: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _estado = MutableStateFlow(CargarGastoEstado())

    /** Un id por gasto (no por toque): reintentar tras un rechazo no crea otro. */
    private val idDelGasto by lazy { nuevoId() }

    /**
     * Una operación por gasto: si guardar falla después de haberse registrado (al avisar a la sincronización), el
     * reintento es la misma operación y queda como duplicada, no como otro gasto.
     */
    private val idDeLaOperacion by lazy { nuevoId() }
    val estado: StateFlow<CargarGastoEstado> = _estado

    init {
        viewModelScope.launch {
            val e = withContext(hilo) { armar() }
            _estado.value = e
        }
    }

    private fun armar(): CargarGastoEstado {
        val l = lector()
        val viaje = l.viaje() ?: return CargarGastoEstado(cargando = false)
        val monedas = l.monedas().filter { it.habilitada }.map { it.moneda }
        val categorias = l.categorias().filter { !it.archivada }
        val gastos = l.gastos()
        val d = CargaDeGastos.porDefecto(gastos, monedas.map { it.codigo }, categorias.map { it.id }.toSet(), yo(), viaje.zonaHoraria, ahoraMs(), viaje.fechaFin)
        // "Otro" va siempre, al final
        val opciones = categorias.filter { it.id != CargaDeGastos.OTRO }.map { OpcionDeCategoria(it.id, it.nombre, it.emoji) } +
            (categorias.firstOrNull { it.id == CargaDeGastos.OTRO }?.let { OpcionDeCategoria(it.id, it.nombre, it.emoji) } ?: OpcionDeCategoria(CargaDeGastos.OTRO, "Otro", "📦"))
        return CargarGastoEstado(
            cargando = false,
            monedas = monedas,
            nombresDeMoneda = monedas.associate { it.codigo to Formatos.nombreDeMoneda(it.codigo) },
            moneda = d.moneda,
            categorias = opciones,
            categoria = d.categoriaId,
            sugerenciasDeLugar = CargaDeGastos.sugerencias(gastos, { it.lugar }),
            sugerenciasDeAlias = CargaDeGastos.sugerencias(gastos, { it.aliasTarjeta }),
            // un método que esta versión no ofrece no se propone (no se vería cuál quedó elegido)
            metodo = d.metodoPago?.takeIf { m -> METODOS_DE_PAGO.any { it.codigo == m } },
            diaImputado = d.diaImputado,
            hoy = EstadoDelViaje.diaEn(ahoraMs(), viaje.zonaHoraria),
            diaPropuesto = d.diaImputado,
            finDelViaje = viaje.fechaFin,
            topes = l.monedas().mapNotNull { m -> m.topeMinor?.let { m.moneda.codigo to it } }.toMap(),
            gastado = CargaDeGastos.gastadoPorMoneda(gastos),
        )
    }

    private fun cambiar(f: (CargarGastoEstado) -> CargarGastoEstado) = _estado.update { f(it).copy(mensaje = null) }

    /** Una tecla del teclado del monto (dígito o coma): el texto se vuelve a formatear con la moneda. */
    fun alTocarTecla(t: Char) = cambiar { e ->
        val m = e.monedaElegida ?: return@cambiar e
        e.copy(montoTexto = Dinero.formatearEntrada(e.montoTexto + t, m), errorDelMonto = null, centavosQuitados = null)
    }

    fun alBorrar() = cambiar { e ->
        val m = e.monedaElegida ?: return@cambiar e
        e.copy(montoTexto = if (e.montoTexto.isEmpty()) "" else Dinero.formatearEntrada(e.montoTexto.dropLast(1), m), centavosQuitados = null)
    }

    fun alBorrarTodo() = cambiar { it.copy(montoTexto = "", centavosQuitados = null) }

    /** Otra moneda: el monto se vuelve a leer con sus decimales (de reales a guaraníes se pierden los centavos). */
    fun alElegirMoneda(codigo: String) = cambiar { e ->
        val m = e.monedas.firstOrNull { it.codigo == codigo } ?: return@cambiar e
        // sin decimales, lo que va después de la coma se descarta (si no, los centavos pasarían a ser parte del número)
        conMoneda(e, m)
    }

    fun alElegirCategoria(id: String) = cambiar { it.copy(categoria = id) }

    /** Tocar el elegido lo deja sin método. */
    fun alElegirMetodo(codigo: String) = cambiar { it.copy(metodo = if (it.metodo == codigo) null else codigo) }

    fun alCambiarLugar(t: String) = cambiar { it.copy(lugar = t) }

    fun alCambiarConcepto(t: String) = cambiar { it.copy(concepto = t) }

    fun alCambiarAlias(t: String) = cambiar { it.copy(alias = t) }

    fun alCambiarNota(t: String) = cambiar { it.copy(nota = t) }

    fun alElegirDia(dia: String) = cambiar { it.copy(diaImputado = dia) }

    fun alMostrarMas() = cambiar { it.copy(mostrarMas = !it.mostrarMas) }

    fun alGuardar() {
        val e = _estado.value
        // ya guardado (un segundo toque mientras se cierra la pantalla): no se guarda otra vez
        if (e.enviando || e.cargando || e.listo) return
        val m = e.monedaElegida ?: return
        val monto = (Dinero.parsear(e.montoTexto, m) as? ResultadoParseo.Ok)?.minor?.takeIf { it > 0 }
            ?: return _estado.update { it.copy(errorDelMonto = R.string.gasto_monto_falta) }
        _estado.update { it.copy(enviando = true, mensaje = null) }
        val id = idDelGasto
        val leido = Dinero.formatear(monto, m)
        var guardadoAntes: Gasto? = null
        viewModelScope.launch {
            val r = withContext(hilo) {
                val b = BorradorDeGasto(
                    montoMinor = monto, moneda = e.moneda, categoriaId = e.categoria, cuandoOcurrio = ahoraMs(), diaImputado = e.diaImputado,
                    concepto = e.concepto, lugar = e.lugar, metodoPago = e.metodo, aliasTarjeta = e.alias, nota = e.nota,
                )
                try {
                    registrar(b, id, idDeLaOperacion).also { res ->
                        // ya estaba guardado (un intento anterior falló después de registrarse): el aviso dice lo que quedó
                        if (res == Resultado.Duplicada) guardadoAntes = lector().gastos().find { it.id == id }
                    }
                } catch (_: ViajeNoVinculado) {
                    // el viaje ya no está vinculado (revocado o sin token)
                    null
                } catch (_: Exception) {
                    // cualquier otra falla (la base, por ejemplo): no se guardó, se puede reintentar
                    Resultado.Rechazada(Razon.FORMATO)
                }
            }
            when {
                r is Resultado.Aceptada || r == Resultado.Duplicada -> _estado.update {
                    val antes = guardadoAntes
                    val texto = antes?.let { g -> it.monedas.find { x -> x.codigo == g.moneda }?.let { x -> Dinero.formatear(g.montoMinor, x) } } ?: leido
                    val dia = antes?.diaImputado ?: it.diaImputado
                    it.copy(enviando = false, listo = true, guardado = GastoGuardado(id, texto, dia.takeIf { d -> d != it.hoy }))
                }
                r is Resultado.Rechazada && r.razon in RECARGAN -> {
                    // la moneda, la categoría o el fin del viaje cambiaron (otro celular): se recargan las opciones y se avisa
                    val nuevas = withContext(hilo) { armar() }
                    _estado.update {
                        val moneda = nuevas.monedas.find { m -> m.codigo == it.moneda } ?: nuevas.monedas.find { m -> m.codigo == nuevas.moneda }
                        (moneda?.let { m -> conMoneda(it, m) } ?: it).copy(
                            enviando = false, monedas = nuevas.monedas, finDelViaje = nuevas.finDelViaje, nombresDeMoneda = nuevas.nombresDeMoneda, categorias = nuevas.categorias,
                            topes = nuevas.topes, gastado = nuevas.gastado,
                            categoria = if (nuevas.categorias.any { c -> c.id == it.categoria }) it.categoria else CargaDeGastos.OTRO,
                            mensaje = mensajeDe(r.razon),
                        )
                    }
                }
                r is Resultado.Rechazada -> _estado.update { it.copy(enviando = false, mensaje = mensajeDe(r.razon)) }
                else -> _estado.update { it.copy(enviando = false, mensaje = R.string.gasto_sin_viaje) }
            }
        }
    }

    /** Pasa a otra moneda con el monto escrito: a una sin decimales se le quitan los centavos (y se avisa). */
    private fun conMoneda(e: CargarGastoEstado, m: Moneda): CargarGastoEstado {
        val texto = if (m.decimales == 0) e.montoTexto.substringBefore(',') else e.montoTexto
        val quitados = if (m.decimales == 0 && e.montoTexto.contains(',')) "," + e.montoTexto.substringAfter(',') else null
        return e.copy(moneda = m.codigo, montoTexto = Dinero.formatearEntrada(texto, m), centavosQuitados = quitados?.takeIf { it.length > 1 })
    }

    private companion object {
        val RECARGAN = setOf(Razon.MONEDA_NO_HABILITADA, Razon.ENTIDAD_INEXISTENTE, Razon.FUERA_DEL_VIAJE)
    }

    private fun mensajeDe(r: Razon): Int = when (r) {
        Razon.FUERA_DEL_VIAJE -> R.string.gasto_fuera_del_viaje
        Razon.VIAJE_CERRADO -> R.string.gasto_viaje_cerrado
        Razon.MONEDA_NO_HABILITADA -> R.string.gasto_moneda_quitada
        Razon.ENTIDAD_INEXISTENTE -> R.string.gasto_categoria_quitada
        else -> R.string.gasto_no_se_pudo
    }
}
