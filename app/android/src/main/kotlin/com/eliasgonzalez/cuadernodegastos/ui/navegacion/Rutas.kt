// Los destinos de la app. Cada pantalla nueva suma su ruta acá y su entrada en el grafo.
package com.eliasgonzalez.cuadernodegastos.ui.navegacion

object Rutas {
    const val BIENVENIDA = "bienvenida"
    const val NUEVO_VIAJE = "nuevo-viaje"
    const val UNIRSE = "unirse"
    const val HOY = "hoy/{viaje}"
    const val CARGAR_GASTO = "gasto/{viaje}"
    const val GASTOS = "gastos/{viaje}"
    const val DETALLE = "detalle/{viaje}/{gasto}"
    const val EDITAR = "editar/{viaje}/{gasto}"

    fun hoy(viaje: String) = "hoy/$viaje"

    fun cargarGasto(viaje: String) = "gasto/$viaje"

    fun gastos(viaje: String) = "gastos/$viaje"

    fun detalle(viaje: String, gasto: String) = "detalle/$viaje/$gasto"

    fun editar(viaje: String, gasto: String) = "editar/$viaje/$gasto"
}
