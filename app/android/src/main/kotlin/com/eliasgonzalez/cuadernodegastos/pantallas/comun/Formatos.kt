// Cómo se muestran fechas y zonas horarias en las pantallas.
package com.eliasgonzalez.cuadernodegastos.pantallas.comun

import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

object Formatos {
    private val meses = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    /** "2027-02-15" → "15 feb 2027". */
    fun fechaCorta(iso: String): String = LocalDate.parse(iso).let { "${it.dayOfMonth} ${meses[it.monthValue - 1]} ${it.year}" }

    private val mesesLargos = listOf("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre")

    /** "2027-02-15" → "15 de febrero". */
    fun fechaLarga(iso: String): String = LocalDate.parse(iso).let { "${it.dayOfMonth} de ${mesesLargos[it.monthValue - 1]}" }

    /** "2027-02-15" → "15 feb". */
    fun diaYMes(iso: String): String = LocalDate.parse(iso).let { "${it.dayOfMonth} ${meses[it.monthValue - 1]}" }

    private val ciudades = mapOf("Asuncion" to "Asunción", "Sao_Paulo" to "São Paulo", "Bogota" to "Bogotá", "Mexico_City" to "Ciudad de México")

    /** La ciudad de la zona, para leer: "America/Asuncion" → "Asunción". */
    fun ciudad(zona: String): String = zona.substringAfterLast('/').let { ciudades[it] ?: it.replace('_', ' ') }

    /** "America/Asuncion" → "América/Asunción · UTC−3" (la diferencia de hoy). */
    fun zona(zona: String, hoyMs: Long = System.currentTimeMillis()): String {
        val region = zona.substringBefore('/', "").let { if (it == "America") "América" else it }
        val desfase = ZoneId.of(zona).rules.getOffset(java.time.Instant.ofEpochMilli(hoyMs)).totalSeconds / 3600
        val signo = if (desfase < 0) "−" else "+"
        val nombre = if (region.isEmpty()) ciudad(zona) else "$region/${ciudad(zona)}"
        return "$nombre · UTC$signo${kotlin.math.abs(desfase)}"
    }

    /** El nombre de la moneda en español, para los chips ("Guaraní"); si no se conoce, el del sistema. */
    fun nombreDeMoneda(codigo: String): String = when (codigo) {
        "PYG" -> "Guaraní"
        "BRL" -> "Real"
        else -> runCatching { java.util.Currency.getInstance(codigo).getDisplayName(Locale.forLanguageTag("es")).replaceFirstChar { it.uppercase() } }.getOrDefault(codigo)
    }

}
