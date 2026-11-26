// Lo que muestra la pantalla de unirse: lo cargado, si está esperando la respuesta y qué decir.
package com.eliasgonzalez.cuadernodegastos.pantallas.unirse

data class UnirseEstado(
    val codigo: String = "",
    val apodo: String = "",
    val emoji: Int = 0,
    val enviando: Boolean = false,
    /** Los errores de cada campo ("codigo", "apodo"): recurso del mensaje. */
    val errores: Map<String, Int> = emptyMap(),
    /** Un aviso general (sin conexión, viaje completo…), o null. */
    val mensaje: Int? = null,
) {
    /** Si ya cargó algo que se perdería al salir. */
    val cargoAlgo: Boolean get() = codigo.isNotBlank() || apodo.isNotBlank()
}
