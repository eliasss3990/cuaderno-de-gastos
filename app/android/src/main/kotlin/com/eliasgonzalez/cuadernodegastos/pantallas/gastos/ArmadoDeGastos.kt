// Arma la lista de gastos a partir de lo que da el dominio (textos y montos con formato): probado aparte.
package com.eliasgonzalez.cuadernodegastos.pantallas.gastos

import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.DiaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.GastosDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.ArmadoDeHoy
import java.time.LocalDate
import java.time.ZoneId

object ArmadoDeGastos {
    private val dias = listOf("LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO")
    private val meses = listOf("ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC")

    /** "JUEVES 18 FEB". */
    fun tituloDelDia(dia: String): String = LocalDate.parse(dia).let { "${dias[it.dayOfWeek.value - 1]} ${it.dayOfMonth} ${meses[it.monthValue - 1]}" }

    /** [hoy]: AAAA-MM-DD en la zona del viaje, para decir "HOY" y "AYER". */
    fun armar(g: GastosDelViaje, monedas: Map<String, Moneda>, sinc: EstadoDeSincronizacion?, pendientes: Int, hoy: String? = null): GastosEstado {
        val zona = ZoneId.of(g.viaje.zonaHoraria)
        val ayer = hoy?.let { LocalDate.parse(it).minusDays(1).toString() }
        fun montos(t: Map<String, Long>) = t.map { (codigo, minor) -> monedas[codigo]?.let { Dinero.formatear(minor, it) } ?: "$codigo $minor" }.joinToString(" · ")
        fun dia(d: DiaDeGastos) = DiaEnPantalla(
            dia = d.dia,
            titulo = when (d.dia) {
                hoy -> "HOY · "
                ayer -> "AYER · "
                else -> ""
            } + tituloDelDia(d.dia),
            totales = montos(d.totales),
            gastos = d.gastos.map { ArmadoDeHoy.filaDe(it, monedas, zona) },
        )
        val (texto, tono) = ArmadoDeHoy.indicador(sinc, pendientes)
        val prep = g.preparacion.flatMap { it.totales.entries }.groupBy({ it.key }, { it.value }).mapValues { it.value.sum() }.toSortedMap()
        return GastosEstado(
            cargando = false, delViaje = g.delViaje.map(::dia), preparacion = g.preparacion.map(::dia), sincronizacion = texto, tono = tono,
            antesDe = g.viaje.fechaInicio?.let { LocalDate.parse(it).let { d -> "${d.dayOfMonth} ${meses[d.monthValue - 1].lowercase()}" } },
            totalPreparacion = prep.takeIf { it.isNotEmpty() }?.let(::montos),
        )
    }
}
