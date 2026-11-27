// Lo que muestra la pantalla de cargar un gasto: lo que se va escribiendo, las opciones del viaje y cómo terminó.
package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto

import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.EstadoDeAccion
import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.base.ResultadoParseo
import com.eliasgonzalez.cuadernodegastos.dominio.gastos.AvisoDelTope
import com.eliasgonzalez.cuadernodegastos.dominio.gastos.CargaDeGastos

/** Los largos que admite la validación de una operación: concepto, lugar y alias; nota. */
const val CORTO = 200
const val LARGO = 2000

data class OpcionDeCategoria(val id: String, val nombre: String, val emoji: String)

/** Un método de pago con su código (el que viaja) y el texto que se muestra. */
data class OpcionDePago(val codigo: String, val texto: String)

data class CargarGastoEstado(
    val cargando: Boolean = true,
    val monedas: List<Moneda> = emptyList(),
    val nombresDeMoneda: Map<String, String> = emptyMap(),
    val moneda: String = "",
    /** El monto como se escribió, ya con el formato de la moneda ("137,50"). */
    val montoTexto: String = "",
    val categorias: List<OpcionDeCategoria> = emptyList(),
    val categoria: String = "otro",
    val metodo: String? = null,
    val lugar: String = "",
    val sugerenciasDeLugar: List<String> = emptyList(),
    val concepto: String = "",
    val alias: String = "",
    val sugerenciasDeAlias: List<String> = emptyList(),
    val nota: String = "",
    /** El día al que cuenta (AAAA-MM-DD) y el de hoy en la zona del viaje. */
    val diaImputado: String = "",
    val hoy: String = "",
    /** El día con que arrancó el formulario (hoy, o el último del viaje si ya terminó): cambiarlo cuenta como cargar algo. */
    val diaPropuesto: String = "",
    /** El último día del viaje, o null sin fecha de fin: el calendario no deja pasarse. */
    val finDelViaje: String? = null,
    val mostrarMas: Boolean = false,
    val enviando: Boolean = false,
    /** Recurso del error del monto, o null. */
    val errorDelMonto: Int? = null,
    /** Recurso de un aviso general (no se pudo guardar), o null. */
    val mensaje: Int? = null,
    /** El tope de todo el viaje y lo ya gastado, por moneda: para avisar si con este gasto se pasan. */
    val topes: Map<String, Long> = emptyMap(),
    val gastado: Map<String, Long> = emptyMap(),
    /** Lo que se quitó al pasar a una moneda sin decimales (",3"), para avisarlo; se va al tocar otra tecla. */
    val centavosQuitados: String? = null,
    /** Guardado: la pantalla se cierra y Hoy ofrece deshacer. */
    val listo: Boolean = false,
    /** El gasto guardado, para el aviso con deshacer. */
    val guardado: GastoGuardado? = null,
    /** Editando un gasto: lo que tenía al abrir (para saber si se cambió algo); null al cargar uno nuevo. */
    val inicial: List<Any?>? = null,
    /** Editando: si cambió algo que valga guardar (si no, "Guardar cambios" queda apagado). */
    val hayCambios: Boolean = true,
) {
    val editando: Boolean get() = inicial != null

    /** Guardar: en curso mientras se registra, hecha si se guardó (hasta que la pantalla se va). */
    val accion: EstadoDeAccion get() = when {
        listo && guardado != null -> EstadoDeAccion.HECHA
        enviando -> EstadoDeAccion.EN_CURSO
        else -> EstadoDeAccion.LISTA
    }

    /** Lo que se puede cambiar, para comparar con [inicial]. */
    val campos: List<Any?> get() = listOf(moneda, monedaElegida?.let { (Dinero.parsear(montoTexto, it) as? ResultadoParseo.Ok)?.minor } ?: montoTexto, categoria, metodo, lugar.trim(), concepto.trim(), alias.trim(), nota.trim(), diaImputado)

    val conTarjeta: Boolean get() = metodo in CargaDeGastos.CON_TARJETA
    val monedaElegida: Moneda? get() = monedas.firstOrNull { it.codigo == moneda }

    /** Cómo queda el viaje contra su tope con lo escrito: se avisa sin bloquear (ya pasado: desde que abre). */
    val avisoDelTope: AvisoDelTope get() {
        val m = monedaElegida ?: return AvisoDelTope.NINGUNO
        val minor = (Dinero.parsear(montoTexto, m) as? ResultadoParseo.Ok)?.minor ?: 0
        return CargaDeGastos.avisoDelTope(minor, gastado[moneda] ?: 0, topes[moneda])
    }

    /** Si ya escribió algo que se perdería al salir. */
    val cargoAlgo: Boolean get() = if (inicial != null) inicial.isNotEmpty() && hayCambios else montoTexto.isNotEmpty() || lugar.isNotBlank() || concepto.isNotBlank() || nota.isNotBlank() || alias.isNotBlank() || diaImputado != diaPropuesto
}

/** Lo que Hoy necesita para avisar: el id (para deshacer), el monto para leer ("₲ 150.005") y el día si no es hoy. */
data class GastoGuardado(val id: String, val monto: String, val otroDia: String? = null)
