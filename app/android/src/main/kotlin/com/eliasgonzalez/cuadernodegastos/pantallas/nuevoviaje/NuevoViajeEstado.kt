// Lo que muestra el nuevo viaje en sus dos pasos (datos; tope y efectivo), ya preparado para dibujar.
package com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje

import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda

/** Una moneda que se puede elegir para el viaje. */
data class MonedaElegible(val moneda: Moneda, val nombre: String, val elegida: Boolean)

/** Cuándo arranca el viaje respecto de hoy: decide qué explica el aviso de arriba. */
enum class Arranque { SIN_SALIDA, FALTA, HOY, YA_ARRANCO }

/** El promedio diario sugerido de una moneda, ya con su texto. */
data class PromedioSugerido(val moneda: Moneda, val monto: String, val cuenta: String)

data class NuevoViajeEstado(
    val paso: Int = 1,
    val nombre: String = "",
    /** AAAA-MM-DD o null. */
    val fechaInicio: String? = null,
    val fechaFin: String? = null,
    val sinFechaFin: Boolean = false,
    val zona: String = "UTC",
    val monedas: List<MonedaElegible> = emptyList(),
    val apodo: String = "",
    val emoji: Int = 0,
    /** Lo escrito en cada campo del paso 2, por código de moneda (con el formato de la moneda). */
    val topes: Map<String, String> = emptyMap(),
    val efectivo: Map<String, String> = emptyMap(),
    val objetivos: String = "",
    // lo que se calcula para mostrar
    val arranque: Arranque = Arranque.SIN_SALIDA,
    /** La fecha de salida para leer ("15 de febrero"), o vacía. */
    val salidaParaLeer: String = "",
    /** La ciudad de la zona horaria ("Asunción"). */
    val ciudad: String = "",
    val dias: Long? = null,
    val promedios: List<PromedioSugerido> = emptyList(),
    val enviando: Boolean = false,
    /** Recurso del mensaje general (una falla al crear), o null. */
    val mensaje: Int? = null,
    /** Lo que falta o está mal en cada campo ("nombre", "monedas", "apodo", "fecha_fin"): recurso del mensaje. */
    val errores: Map<String, Int> = emptyMap(),
    /** El texto de un problema del plan que viene del servicio, o null. */
    val problema: String? = null,
) {
    /** Si ya cargó algo que se perdería al salir. */
    val cargoAlgo: Boolean get() = nombre.isNotBlank() || apodo.isNotBlank() || fechaInicio != null || fechaFin != null
}
