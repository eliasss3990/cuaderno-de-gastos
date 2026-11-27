// La lista de gastos por día: los del viaje (desde el inicio) y los de la preparación (antes), cada día con su total
// por moneda. Lo de la papelera no aparece.
package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

data class DiaDeGastos(
    /** AAAA-MM-DD. */
    val dia: String,
    /** Por código de moneda, en orden de código; solo las monedas que tienen gastos ese día. */
    val totales: Map<String, Long>,
    /** Del más reciente al más viejo. */
    val gastos: List<GastoDeHoy>,
)

data class GastosDelViaje(
    val viaje: Viaje,
    /** Del día más nuevo al más viejo. */
    val delViaje: List<DiaDeGastos>,
    val preparacion: List<DiaDeGastos>,
)

object ListaDeGastos {
    /** Null si el viaje todavía no está. */
    fun armar(lector: LectorDelViaje): GastosDelViaje? {
        val viaje = lector.viaje() ?: return null
        val categorias = lector.categorias().associateBy { it.id }
        val integrantes = lector.integrantes().associateBy { it.id }
        val vivos = lector.gastos().filter { !it.eliminado }
        // sin fecha de inicio todavía no hay preparación: todo es del viaje
        val (antes, durante) = vivos.partition { viaje.fechaInicio != null && it.diaImputado < viaje.fechaInicio }
        fun porDia(l: List<Gasto>) = l.groupBy { it.diaImputado }.toSortedMap(reverseOrder()).map { (dia, deEseDia) ->
            DiaDeGastos(
                dia = dia,
                totales = deEseDia.groupBy { it.moneda }.toSortedMap().mapValues { (_, g) -> g.sumOf { it.montoMinor } },
                gastos = deEseDia.sortedWith(compareByDescending<Gasto> { it.cuandoOcurrio }.thenBy { it.id })
                    .map { GastoDeHoy(it, categorias[it.categoriaId], it.autor?.let(integrantes::get)) },
            )
        }
        return GastosDelViaje(viaje, porDia(durante), porDia(antes))
    }

    /** Un gasto con su categoría y quién lo cargó, también si está en la papelera; null si no existe. */
    fun detalle(lector: LectorDelViaje, gastoId: String): GastoDeHoy? {
        val g = lector.gastos().find { it.id == gastoId } ?: return null
        return GastoDeHoy(
            g, lector.categorias().find { it.id == g.categoriaId },
            g.autor?.let { a -> lector.integrantes().find { it.id == a } },
        )
    }
}
