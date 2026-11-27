// Cargar un gasto: arma el formulario con los valores por defecto, va formateando el monto y registra el alta fuera del
// hilo principal; lo que decide qué viaja está en CargaDeGastos (dominio).
package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import kotlin.math.pow
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
    /**
     * Registra la operación que arma la función que recibe al final, con la marca de la sincronización (bloquea); lanza
     * ViajeNoVinculado si el viaje ya no está. También recibe el borrador y los ids, para quien solo quiera mirarlos.
     */
    private val registrar: (BorradorDeGasto, String, String, (String) -> Operacion) -> Resultado,
    private val nuevoId: () -> String = { Ids.nuevo() },
    private val hilo: CoroutineDispatcher = Dispatchers.IO,
    private val ahoraMs: () -> Long = System::currentTimeMillis,
    /** El gasto a editar, o null para cargar uno nuevo. */
    private val editar: String? = null,
) : ViewModel() {
    // editando se sabe desde antes de cargar (el teclado del monto arranca cerrado, sin aparecer y irse)
    private val _estado = MutableStateFlow(CargarGastoEstado(inicial = if (editar != null) emptyList() else null))

    /** Un id por gasto (no por toque): reintentar tras un rechazo no crea otro. */
    private val idDelGasto by lazy { editar ?: nuevoId() }

    /** El gasto como estaba al abrir (editando). */
    private var antes: Gasto? = null

    /**
     * Una operación por gasto: si guardar falla después de haberse registrado (al avisar a la sincronización), el
     * reintento es la misma operación y queda como duplicada, no como otro gasto.
     */
    private var idDeLaOperacion = ""

    /** Lo que se mandó en el último intento: editando, si cambió, es otra operación (si no, quedaría como duplicada y no viajaría). */
    private var ultimoBorrador: BorradorDeGasto? = null
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
        val gastos = l.gastos()
        val monedaDelEditado = editar?.let { id -> gastos.find { it.id == id }?.moneda }
        val monedas = l.monedas().filter { it.habilitada || it.moneda.codigo == monedaDelEditado }.map { it.moneda }
        val g = editar?.let { id -> gastos.find { it.id == id && !it.eliminado } }
        // ya no está (o su moneda no se puede leer): no hay qué editar
        if (editar != null && (g == null || monedas.none { it.codigo == g.moneda })) return CargarGastoEstado(cargando = false, listo = true)
        if (antes == null) antes = g
        // editando, su categoría va aunque esté archivada (si no, no se vería cuál tiene)
        val categorias = l.categorias().filter { !it.archivada || it.id == g?.categoriaId }
        val d = CargaDeGastos.porDefecto(gastos, monedas.map { it.codigo }, categorias.map { it.id }.toSet(), yo(), viaje.zonaHoraria, ahoraMs(), viaje.fechaFin)
        // "Otro" va siempre, al final
        val opciones = categorias.filter { it.id != CargaDeGastos.OTRO }.map { OpcionDeCategoria(it.id, it.nombre, it.emoji) } +
            (categorias.firstOrNull { it.id == CargaDeGastos.OTRO }?.let { OpcionDeCategoria(it.id, it.nombre, it.emoji) } ?: OpcionDeCategoria(CargaDeGastos.OTRO, "Otro", "📦"))
        val nuevo = CargarGastoEstado(
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
        if (g == null) return nuevo
        val m = monedas.first { it.codigo == g.moneda } // está: se comprobó arriba
        val conDatos = nuevo.copy(
            moneda = g.moneda, montoTexto = textoDelMonto(g.montoMinor, m), categoria = g.categoriaId, metodo = g.metodoPago,
            lugar = g.lugar.orEmpty(), concepto = g.concepto.orEmpty(), alias = g.aliasTarjeta.orEmpty(), nota = g.nota.orEmpty(),
            // diaPropuesto queda el de hoy: si el gasto es de otro día, el rótulo de "Más datos" lo nombra
            diaImputado = g.diaImputado,
            // lo gastado sin este gasto (si no, el aviso del tope lo contaría dos veces)
            gastado = CargaDeGastos.gastadoPorMoneda(gastos.filter { it.id != g.id }),
        )
        return conDatos.copy(inicial = conDatos.campos, hayCambios = false)
    }

    /** 13750 en reales → "137,50" (como si se hubiera tecleado). */
    private fun textoDelMonto(minor: Long, m: Moneda): String {
        if (m.decimales == 0) return Dinero.formatearEntrada(minor.toString(), m)
        val base = 10.0.pow(m.decimales).toLong()
        return Dinero.formatearEntrada("${minor / base},${(minor % base).toString().padStart(m.decimales, '0')}", m)
    }

    private fun cambiar(f: (CargarGastoEstado) -> CargarGastoEstado) = _estado.update { f(it).let { n -> n.copy(mensaje = null, hayCambios = hayCambios(n)) } }

    /** Editando: si guardar mandaría algo (lo decide el dominio, igual que al guardar). Cargando uno nuevo: siempre. */
    private fun hayCambios(e: CargarGastoEstado): Boolean {
        val previo = antes ?: return true
        val b = borrador(e) ?: return true
        return CargaDeGastos.edicion(previo, b, "", "") != null
    }

    /**
     * El borrador de lo escrito. [cuando] va solo al alta: para comparar no importa (la edición conserva la hora del
     * gasto), y la hora corregida lee la base: no se pide en el hilo principal en cada tecla.
     */
    private fun borrador(e: CargarGastoEstado, cuando: Long = 0): BorradorDeGasto? {
        val m = e.monedaElegida ?: return null
        val monto = (Dinero.parsear(e.montoTexto, m) as? ResultadoParseo.Ok)?.minor?.takeIf { it > 0 } ?: return null
        return BorradorDeGasto(
            montoMinor = monto, moneda = e.moneda, categoriaId = e.categoria, cuandoOcurrio = cuando, diaImputado = e.diaImputado,
            concepto = e.concepto, lugar = e.lugar, metodoPago = e.metodo, aliasTarjeta = e.alias, nota = e.nota,
        )
    }

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
        val b = borrador(e) ?: return _estado.update { it.copy(errorDelMonto = R.string.gasto_monto_falta) }
        val monto = b.montoMinor
        // editando: "cambió algo" lo decide el dominio (lo que viajaría), no el texto ("137,5" vale lo mismo que "137,50")
        val previo = antes
        // editando sin nada que mandar: se cierra (un intento que quedó guardado y falló ya cerró como guardado)
        if (previo != null && CargaDeGastos.edicion(previo, b, "", "") == null) return _estado.update { it.copy(listo = true) }
        // el alta reintenta siempre con la misma operación (el gasto es uno); la edición, solo si no cambió lo que manda
        val mismoContenido = ultimoBorrador?.copy(cuandoOcurrio = 0) == b.copy(cuandoOcurrio = 0)
        if (idDeLaOperacion.isEmpty() || (previo != null && !mismoContenido)) idDeLaOperacion = nuevoId()
        ultimoBorrador = b
        _estado.update { it.copy(enviando = true, mensaje = null) }
        val id = idDelGasto
        val leido = Dinero.formatear(monto, m)
        var guardadoAntes: Gasto? = null
        // editando: el gasto se borró o fue a la papelera en otro celular mientras tanto
        var yaNoEsta = false
        viewModelScope.launch {
            val r = withContext(hilo) {
                // la hora del alta, fuera del hilo principal (lee la base)
                val b = if (previo == null) b.copy(cuandoOcurrio = ahoraMs()) else b
                try {
                    // editando, lo que viaja es la diferencia con lo que la persona vio al abrir (no pisa lo que otro cambió en otro campo)
                    val operacion: (String) -> Operacion = if (previo != null) {
                        { marca -> CargaDeGastos.edicion(previo, b, idDeLaOperacion, marca)!! }
                    } else {
                        { marca -> CargaDeGastos.alta(b, idDeLaOperacion, id, marca) }
                    }
                    if (previo != null && lector().gastos().none { it.id == id && !it.eliminado }) {
                        yaNoEsta = true
                        return@withContext null
                    }
                    registrar(b, id, idDeLaOperacion, operacion).also { res ->
                        // ya estaba guardado (un intento anterior falló después de registrarse): el aviso dice lo que quedó
                        if (res == Resultado.Duplicada) guardadoAntes = lector().gastos().find { it.id == id }
                    }
                } catch (_: ViajeNoVinculado) {
                    // el viaje ya no está vinculado (revocado o sin token)
                    null
                } catch (_: Exception) {
                    // cualquier otra falla (la base, por ejemplo): se puede reintentar. Editando, pudo haberse guardado
                    // antes de fallar: la base de la próxima diferencia es lo que quedó (volver al valor original lo revierte)
                    if (previo != null) runCatching { lector().gastos().find { it.id == id && !it.eliminado } }.getOrNull()?.let { ahora ->
                        // solo los campos que mandó este intento, y solo si quedaron guardados (lo que cambió otro celular no se toma:
                        // si no, el reintento lo pisaría con el valor viejo del formulario)
                        val mandados = CargaDeGastos.edicion(previo, b, "", "")?.payload?.keys.orEmpty()
                        val pendientes = CargaDeGastos.edicion(ahora, b, "", "")?.payload?.keys.orEmpty()
                        if (mandados.isNotEmpty() && mandados.none { it in pendientes }) {
                            antes = CargaDeGastos.conCampos(previo, b, mandados)
                        }
                    }
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
                // un rechazo por entidad inexistente editando también puede ser el gasto mismo (se borró entre el control y el registro)
                yaNoEsta || (previo != null && r is Resultado.Rechazada && r.razon == Razon.ENTIDAD_INEXISTENTE &&
                    withContext(hilo) { lector().gastos().none { it.id == id && !it.eliminado } }) ->
                    _estado.update { it.copy(enviando = false, mensaje = R.string.gasto_ya_no_esta) }
                r is Resultado.Rechazada && r.razon in RECARGAN -> {
                    // la moneda, la categoría o el fin del viaje cambiaron (otro celular): se recargan las opciones y se avisa
                    val nuevas = withContext(hilo) { armar() }
                    // editando, el gasto pudo irse en el medio: se avisa y no se vuelcan opciones vacías
                    if (nuevas.listo) return@launch _estado.update { it.copy(enviando = false, mensaje = R.string.gasto_ya_no_esta) }
                    _estado.update {
                        val moneda = nuevas.monedas.find { m -> m.codigo == it.moneda } ?: nuevas.monedas.find { m -> m.codigo == nuevas.moneda }
                        (moneda?.let { m -> conMoneda(it, m) } ?: it).copy(
                            enviando = false, monedas = nuevas.monedas, finDelViaje = nuevas.finDelViaje, nombresDeMoneda = nuevas.nombresDeMoneda, categorias = nuevas.categorias,
                            topes = nuevas.topes, gastado = nuevas.gastado,
                            categoria = if (nuevas.categorias.any { c -> c.id == it.categoria }) it.categoria else CargaDeGastos.OTRO,
                            mensaje = mensajeDe(r.razon),
                        ).let { n -> n.copy(hayCambios = hayCambios(n)) }
                    }
                }
                // editando: si falló pero lo mandado ya quedó guardado (no queda diferencia), se cierra como guardado
                r is Resultado.Rechazada && previo != null && !hayCambios(_estado.value) ->
                    _estado.update { it.copy(enviando = false, listo = true, guardado = GastoGuardado(id, leido)) }
                r is Resultado.Rechazada -> _estado.update { it.copy(enviando = false, mensaje = mensajeDe(r.razon), hayCambios = hayCambios(it)) }
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
