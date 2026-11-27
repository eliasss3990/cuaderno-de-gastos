// Lo que dibuja la lista de gastos, ya con textos decididos (la pantalla no calcula nada).
package com.eliasgonzalez.cuadernodegastos.pantallas.gastos

import com.eliasgonzalez.cuadernodegastos.pantallas.comun.GastoEnPantalla
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.Tono

/** Un día de la lista: "JUEVES 18 FEB", lo gastado ese día por moneda y sus gastos. */
data class DiaEnPantalla(val dia: String, val titulo: String, val totales: String, val gastos: List<GastoEnPantalla>)

data class GastosEstado(
    val cargando: Boolean = true,
    /** Leer la base falló (se reintenta con el próximo cambio): se dice en vez de quedar en blanco. */
    val noSePudoLeer: Boolean = false,
    val delViaje: List<DiaEnPantalla> = emptyList(),
    val preparacion: List<DiaEnPantalla> = emptyList(),
    /** "24 nov" (el inicio del viaje), o null sin fecha de inicio. */
    val antesDe: String? = null,
    /** Lo que suma la preparación por moneda ("₲ 2.140.000 · R$ 50,00"), o null si no hay. */
    val totalPreparacion: String? = null,
    val sincronizacion: String = "",
    val tono: Tono = Tono.BIEN,
)
