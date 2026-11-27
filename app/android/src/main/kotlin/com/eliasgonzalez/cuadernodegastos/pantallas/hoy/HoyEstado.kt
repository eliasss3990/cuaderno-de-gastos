// Lo que dibuja Hoy, ya con textos y colores decididos (la pantalla no calcula nada).
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import com.eliasgonzalez.cuadernodegastos.pantallas.comun.GastoEnPantalla
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
