// Las cuentas del presupuesto, por moneda (las mismas en los 4 celulares: salen de los mismos datos).
//   fijos = total de los gastos fijos (pendientes y pagados)
//   preparación = gastos con día imputado antes del inicio; variable = desde el inicio (sin inicio, todo es variable)
//   comprometido = fijos + preparación + variable; uso del tope = comprometido ÷ tope
//   promedio diario sugerido = (tope − fijos − preparación) ÷ días del viaje, hacia abajo a la unidad menor; solo con tope
//   y las dos fechas
//   ritmo = variable ÷ días transcurridos × días del viaje + fijos + preparación; desde el segundo día, con tope y fechas
// Los días del viaje van del inicio al fin: un gasto después del fin no los alarga (cargarlo se rechaza; uno cargado
// antes de adelantar el fin queda). Los gastos en la papelera no cuentan. Los montos están acotados por la validación:
// las sumas de un viaje real entran en Long.
package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje

/** Cómo va un gasto contra su límite: el mismo color en las barras del tope y de lo previsto por día. */
enum class Nivel {
    /** Menos del 80 %: de verde a amarillo según el porcentaje. */
    BIEN,

    /** Del 80 % al 100 %: rojo. */
    CERCA,

    /** Más del 100 %: violeta con ícono y texto (no depende solo del color). */
    SUPERADO,
}

/** Una cantidad contra su límite. `porcentaje` va hacia abajo (86,2 % → 86). */
data class ContraLimite(val gastadoMinor: Long, val limiteMinor: Long) {
    val porcentaje: Long get() = if (limiteMinor <= 0) 0 else (java.math.BigInteger.valueOf(gastadoMinor) * CIEN).divide(java.math.BigInteger.valueOf(limiteMinor)).toLong()

    val nivel: Nivel
        get() = when {
            gastadoMinor > limiteMinor -> Nivel.SUPERADO
            java.math.BigInteger.valueOf(gastadoMinor) * CIEN >= java.math.BigInteger.valueOf(limiteMinor) * OCHENTA -> Nivel.CERCA
            else -> Nivel.BIEN
        }

    private companion object {
        val CIEN: java.math.BigInteger = java.math.BigInteger.valueOf(100)
        val OCHENTA: java.math.BigInteger = java.math.BigInteger.valueOf(80)
    }

    /** Lo que falta para el límite, o lo que se pasó (negativo). */
    val restanteMinor: Long get() = limiteMinor - gastadoMinor
}

data class PresupuestoDeMoneda(
    val moneda: String,
    val fijosMinor: Long,
    val preparacionMinor: Long,
    val variableMinor: Long,
    val topeMinor: Long?,
    /** Null sin tope o sin alguna de las dos fechas (o si el tope ya no alcanza ni para los fijos y la preparación). */
    val promedioDiarioMinor: Long?,
    /** Lo que se gastaría a este ritmo; null el primer día, antes de empezar o sin tope y fechas. */
    val ritmoMinor: Long?,
) {
    val comprometidoMinor: Long get() = fijosMinor + preparacionMinor + variableMinor

    /** Null sin tope: no hay barra. */
    val usoDelTope: ContraLimite? get() = topeMinor?.let { ContraLimite(comprometidoMinor, it) }
}

object Presupuesto {
    /** Días del viaje (inicio y fin incluidos), o null si falta alguna fecha. */
    fun diasDelViaje(v: Viaje): Long? = if (v.fechaInicio != null && v.fechaFin != null) EstadoDelViaje.diasContandoAmbos(v.fechaInicio, v.fechaFin) else null

    fun calcular(v: Viaje, moneda: MonedaDelPlan, gastos: List<Gasto>, fijos: List<GastoFijo>, hoy: String): PresupuestoDeMoneda {
        val codigo = moneda.moneda.codigo
        val vivos = gastos.filter { !it.eliminado && it.moneda == codigo }
        val inicio = v.fechaInicio
        val preparacion = if (inicio == null) 0 else vivos.filter { it.diaImputado < inicio }.sumOf { it.montoMinor }
        val variable = vivos.sumOf { it.montoMinor } - preparacion
        val totalFijos = fijos.filter { it.moneda == codigo }.sumOf { it.totalMinor }
        val dias = diasDelViaje(v)
        val tope = moneda.topeMinor
        val promedio = if (tope != null && dias != null && dias > 0) {
            val disponible = tope - totalFijos - preparacion
            if (disponible >= 0) Dinero.dividirHaciaAbajo(disponible, dias) else null
        } else {
            null
        }
        val transcurridos = if (inicio != null) EstadoDelViaje.diasContandoAmbos(inicio, hoy) else null
        val ritmo = if (tope != null && dias != null && transcurridos != null && transcurridos >= 2) {
            // pasado el fin cuenta como si hubiera terminado: el total ya no se proyecta más allá
            val hechos = minOf(transcurridos, dias)
            // en BigInteger: variable × días puede no entrar en un Long con montos grandes
            (java.math.BigInteger.valueOf(variable) * java.math.BigInteger.valueOf(dias)).divide(java.math.BigInteger.valueOf(hechos)).toLong() + totalFijos + preparacion
        } else {
            null
        }
        return PresupuestoDeMoneda(codigo, totalFijos, preparacion, variable, tope, promedio, ritmo)
    }
}
