// Lo que muestra la pantalla Hoy, ya calculado: el día del viaje, lo gastado hoy por moneda contra lo previsto y los
// últimos gastos de hoy de toda la familia, con su categoría y quién los cargó.
package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda

data class TotalDeHoy(
    val moneda: Moneda,
    val gastadoMinor: Long,
    /** Contra el promedio diario sugerido; null si no hay (sin tope o sin fechas): la barra no aparece. */
    val previsto: ContraLimite?,
)

data class GastoDeHoy(val gasto: Gasto, val categoria: Categoria?, val autor: Integrante?)

data class ResumenDeHoy(
    val viaje: Viaje,
    /** El día de hoy en la zona del viaje (AAAA-MM-DD). */
    val hoy: String,
    /**
     * El número de día del viaje (1 el día de inicio) y cuántos tiene; null antes del inicio, sin inicio, o pasado el último
     * día si el viaje ya no sigue (si alguien lo abrió a mano, se sigue contando).
     */
    val diaDelViaje: Long?,
    val diasDelViaje: Long?,
    /** Una por cada moneda habilitada, en orden de código. */
    val totales: List<TotalDeHoy>,
    /** Los de hoy, del más reciente al más viejo. */
    val ultimos: List<GastoDeHoy>,
)

object Hoy {
    /** Null si el viaje todavía no está (el celular no bajó su alta). */
    fun resumen(lector: LectorDelViaje, ahoraMs: Long): ResumenDeHoy? {
        val viaje = lector.viaje() ?: return null
        val hoy = EstadoDelViaje.diaEn(ahoraMs, viaje.zonaHoraria)
        val gastos = lector.gastos()
        val fijos = lector.gastosFijos()
        val deHoy = gastos.filter { !it.eliminado && it.diaImputado == hoy }
        // antes del inicio lo de hoy es preparación: no se compara con el promedio diario
        val antesDelInicio = viaje.fechaInicio != null && hoy < viaje.fechaInicio
        val totales = lector.monedas().filter { it.habilitada }.map { m ->
            val p = Presupuesto.calcular(viaje, m, gastos, fijos, hoy)
            val gastado = deHoy.filter { it.moneda == m.moneda.codigo }.sumOf { it.montoMinor }
            val previsto = if (antesDelInicio) null else p.promedioDiarioMinor?.takeIf { it > 0 }?.let { ContraLimite(gastado, it) }
            TotalDeHoy(m.moneda, gastado, previsto)
        }
        val dias = Presupuesto.diasDelViaje(viaje, gastos)
        val abiertoAMano = viaje.estadoManual == EstadoViaje.EN_CURSO
        val dia = viaje.fechaInicio?.let { EstadoDelViaje.diasContandoAmbos(it, hoy) }?.takeIf { it >= 1 && (dias == null || it <= dias || abiertoAMano) }
        val categorias = lector.categorias().associateBy { it.id }
        val integrantes = lector.integrantes().associateBy { it.id }
        return ResumenDeHoy(
            viaje = viaje,
            hoy = hoy,
            diaDelViaje = dia,
            diasDelViaje = dias,
            totales = totales,
            // el lector ya los da del más reciente al más viejo
            ultimos = deHoy.map { GastoDeHoy(it, categorias[it.categoriaId], it.autor?.let(integrantes::get)) },
        )
    }
}
