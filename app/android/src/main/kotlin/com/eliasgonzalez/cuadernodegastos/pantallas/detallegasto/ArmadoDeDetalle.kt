// Arma el detalle de un gasto (textos y monto con formato): probado aparte.
package com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto

import com.eliasgonzalez.cuadernodegastos.dominio.gastos.CargaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.GastoDeHoy
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.ArmadoDeHoy
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object ArmadoDeDetalle {
    private val diasLargos = listOf("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")
    private val meses = listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    fun armar(g: GastoDeHoy, monedas: Map<String, Moneda>, zonaHoraria: String): DetalleEstado {
        val gasto = g.gasto
        val cuando = Instant.ofEpochMilli(gasto.cuandoOcurrio).atZone(ZoneId.of(zonaHoraria))
        val imputado = LocalDate.parse(gasto.diaImputado)
        val pago = ArmadoDeHoy.metodoDePago(gasto.metodoPago)?.let { m -> listOfNotNull(m, gasto.aliasTarjeta).joinToString(" · ") }
        return DetalleEstado(
            cargando = false,
            emoji = g.categoria?.emoji ?: "📦",
            fondo = g.categoria?.color ?: "#EEE8D8",
            monto = monedas[gasto.moneda]?.let { Dinero.formatear(gasto.montoMinor, it) } ?: "${gasto.moneda} ${gasto.montoMinor}",
            // "Otro" no dice nada: no se nombra
            subtitulo = ArmadoDeHoy.titulo(g).let { t -> listOfNotNull(t, g.categoria?.takeIf { it.id != CargaDeGastos.OTRO && it.nombre != t }?.nombre).joinToString("\u00A0· ") },
            datos = listOfNotNull(
                g.autor?.let { DatoDelGasto("Quién", "${it.emoji} ${it.apodo}") },
                // el día del gasto (como en el formulario); la hora solo si se anotó ese mismo día, si no va aparte
                if (imputado == cuando.toLocalDate()) {
                    DatoDelGasto("Día", "${diasLargos[imputado.dayOfWeek.value - 1]} ${imputado.dayOfMonth} ${meses[imputado.monthValue - 1]}\u00A0·\u00A0%02d:%02d".format(cuando.hour, cuando.minute))
                } else {
                    DatoDelGasto("Día", "${diasLargos[imputado.dayOfWeek.value - 1]} ${imputado.dayOfMonth} ${meses[imputado.monthValue - 1]}")
                },
                DatoDelGasto("Anotado", "${diasLargos[cuando.dayOfWeek.value - 1]} ${cuando.dayOfMonth} ${meses[cuando.monthValue - 1]}\u00A0·\u00A0%02d:%02d".format(cuando.hour, cuando.minute))
                    .takeIf { imputado != cuando.toLocalDate() },
                // si el lugar ya es el nombre (arriba), no se repite
                gasto.lugar?.takeIf { it != ArmadoDeHoy.titulo(g) }?.let { DatoDelGasto("Lugar", it) },
                pago?.let { DatoDelGasto("Pago", it) },
            ),
            nota = gasto.nota,
            pendiente = gasto.sinConfirmar,
            enPapelera = gasto.eliminado,
        )
    }
}
