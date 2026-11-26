// Estado del viaje: no se guarda ni se sincroniza, se deriva en cada lugar con esta misma función pura.
// Manual si existe; si no, por fechas y zona horaria del viaje: planificado antes de las 00:00 de la fecha de
// inicio (o sin fecha de inicio), en curso desde ahí, cerrado al terminar el día de la fecha de fin.
package com.eliasgonzalez.cuadernodegastos.dominio.base

import java.time.DateTimeException
import java.time.LocalDate
import java.time.ZoneId

enum class EstadoViaje { PLANIFICADO, EN_CURSO, CERRADO }

data class PlanDelViaje(
    /** Solo EN_CURSO o CERRADO (o null): un viaje no se vuelve a planificar a mano. */
    val estadoManual: EstadoViaje?,
    val fechaInicio: String?,
    val fechaFin: String?,
    val zonaHoraria: String,
) {
    init {
        require(estadoManual != EstadoViaje.PLANIFICADO) { "el estado manual solo puede ser EN_CURSO o CERRADO" }
    }
}

object EstadoDelViaje {
    private val FECHA = Regex("([0-9]{4})-([0-9]{2})-([0-9]{2})")

    /** Solo fechas que existen; la validación de las operaciones además acota el año a 1900–2999. */
    private fun fecha(texto: String): LocalDate {
        val m = requireNotNull(FECHA.matchEntire(texto)) { "fecha inválida: $texto" }
        val (a, mes, d) = m.destructured
        return try {
            LocalDate.of(a.toInt(), mes.toInt(), d.toInt())
        } catch (e: DateTimeException) {
            throw IllegalArgumentException("fecha inválida: $texto", e)
        }
    }

    // el servidor (Intl) acepta la zona con cualquier combinación de mayúsculas; java.time no
    private val zonasSinMayusculas: Map<String, String> by lazy { ZoneId.getAvailableZoneIds().associateBy { it.lowercase() } }

    private fun zona(texto: String): ZoneId = try {
        ZoneId.of(texto)
    } catch (e: DateTimeException) {
        val nombre = zonasSinMayusculas[texto.lowercase()] ?: throw IllegalArgumentException("zona horaria inválida: $texto", e)
        ZoneId.of(nombre)
    }

    /**
     * Primer instante (ms epoch UTC) en que el reloj de la zona marca `fecha` 00:00. Si esa hora no existe (el
     * horario de verano salta a medianoche), el primer instante de ese día que sí existe.
     */
    fun inicioDelDia(fecha: String, zonaHoraria: String): Long =
        fecha(fecha).atStartOfDay(zona(zonaHoraria)).toInstant().toEpochMilli()

    fun diaSiguiente(fecha: String): String = fecha(fecha).plusDays(1).toString()

    /** El día (AAAA-MM-DD) que marca el reloj de la zona en ese instante. */
    fun diaEn(ahoraMs: Long, zonaHoraria: String): String =
        java.time.Instant.ofEpochMilli(ahoraMs).atZone(zona(zonaHoraria)).toLocalDate().toString()

    /** Cuántos días van de `desde` a `hasta`, contando los dos (el mismo día da 1; antes de `desde`, 0 o menos). */
    fun diasContandoAmbos(desde: String, hasta: String): Long = java.time.temporal.ChronoUnit.DAYS.between(fecha(desde), fecha(hasta)) + 1

    /** Instante en que el viaje pasa a cerrado por fechas (al terminar el día de la fecha de fin), o null. */
    fun cierrePorFechas(fechaFin: String?, zonaHoraria: String): Long? =
        fechaFin?.let { inicioDelDia(diaSiguiente(it), zonaHoraria) }

    fun estado(plan: PlanDelViaje, ahoraMs: Long): EstadoViaje {
        plan.estadoManual?.let { return it }
        val cierre = cierrePorFechas(plan.fechaFin, plan.zonaHoraria)
        if (cierre != null && ahoraMs >= cierre) return EstadoViaje.CERRADO
        if (plan.fechaInicio != null && ahoraMs >= inicioDelDia(plan.fechaInicio, plan.zonaHoraria)) return EstadoViaje.EN_CURSO
        return EstadoViaje.PLANIFICADO
    }
}
