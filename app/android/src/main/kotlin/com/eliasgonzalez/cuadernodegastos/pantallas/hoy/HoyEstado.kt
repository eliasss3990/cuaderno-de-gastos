// Lo que dibuja Hoy, ya con textos y colores decididos (la pantalla no calcula nada).
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Nivel
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.Tono

/** Lo gastado hoy en una moneda y, si hay promedio, cómo va contra lo previsto. */
data class TotalEnPantalla(
    val nombre: String,
    val codigo: String,
    val monto: String,
    val previsto: String?,
    val porcentaje: Long?,
    val nivel: Nivel?,
)

data class GastoEnPantalla(
    val id: String,
    val emoji: String,
    val fondo: String,
    val titulo: String,
    val detalle: String?,
    val quien: String,
    val monto: String,
    val codigo: String,
    val pendiente: Boolean,
)

data class HoyEstado(
    val cargando: Boolean = true,
    val titulo: String = "",
    val fecha: String = "",
    val dia: String? = null,
    val totales: List<TotalEnPantalla> = emptyList(),
    val gastos: List<GastoEnPantalla> = emptyList(),
    val sincronizacion: String = "",
    val tono: Tono = Tono.BIEN,
)
