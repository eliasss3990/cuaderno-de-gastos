// Los destinos de la app. Cada pantalla nueva suma su ruta acá y su entrada en el grafo.
package com.eliasgonzalez.cuadernodegastos.ui.navegacion

object Rutas {
    const val BIENVENIDA = "bienvenida"
    const val NUEVO_VIAJE = "nuevo-viaje"
    const val UNIRSE = "unirse"
    const val HOY = "hoy/{viaje}"

    fun hoy(viaje: String) = "hoy/$viaje"
}
