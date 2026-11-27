// Arma lo que muestra Hoy a partir del resumen del día (textos, montos con formato, colores): todo probado aparte.
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import com.eliasgonzalez.cuadernodegastos.dominio.gastos.CargaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.GastoDeHoy
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.GastoEnPantalla
import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.ResumenDeHoy
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.Tono
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object ArmadoDeHoy {
    private val dias = listOf("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
    private val meses = listOf("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre")

    /** El nombre de la moneda en plural para el total ("Guaraníes", "Reales"). */
    fun plural(codigo: String): String = when (codigo) {
        "PYG" -> "Guaraníes"
        "BRL" -> "Reales"
        else -> codigo
    }

    fun metodoDePago(codigo: String?): String? = when (codigo) {
        null -> null
        "EFECTIVO" -> "Efectivo"
        "CREDITO" -> "Crédito"
        "DEBITO" -> "Débito"
        "PIX" -> "Pix"
        "TRANSFERENCIA" -> "Transferencia o QR"
        "OTRO" -> "Otro"
        else -> codigo.lowercase().replaceFirstChar { it.uppercase() }
    }

    fun armar(r: ResumenDeHoy, sinc: EstadoDeSincronizacion?, pendientes: Int): HoyEstado {
        val hoy = LocalDate.parse(r.hoy)
        val fecha = "HOY · ${dias[hoy.dayOfWeek.value - 1]} ${hoy.dayOfMonth} de ${meses[hoy.monthValue - 1]}".uppercase()
        val zona = ZoneId.of(r.viaje.zonaHoraria)
        val monedas = r.totales.associateBy { it.moneda.codigo }
        val (texto, tono) = indicador(sinc, pendientes)
        return HoyEstado(
            cargando = false,
            titulo = r.viaje.nombre,
            fecha = fecha,
            dia = r.diaDelViaje?.let { d -> r.diasDelViaje?.let { "día $d de $it" } ?: "día $d" },
            totales = r.totales.map { t ->
                TotalEnPantalla(
                    nombre = plural(t.moneda.codigo),
                    codigo = t.moneda.codigo,
                    monto = Dinero.formatear(t.gastadoMinor, t.moneda),
                    previsto = t.previsto?.let { "Para hoy: ${Dinero.formatear(it.limiteMinor, t.moneda)}" },
                    porcentaje = t.previsto?.porcentaje,
                    nivel = t.previsto?.nivel,
                )
            },
            gastos = r.ultimos.map { filaDe(it, monedas.mapValues { m -> m.value.moneda }, zona) },
            sincronizacion = texto,
            tono = tono,
        )
    }

    /** El nombre de un gasto (igual en la fila, el detalle y los avisos): concepto, lugar, categoría salvo "Otro". */
    fun titulo(g: GastoDeHoy): String =
        g.gasto.concepto ?: g.gasto.lugar ?: g.categoria?.takeIf { it.id != CargaDeGastos.OTRO }?.nombre
            ?: g.gasto.nota?.let { if (it.length > 40) it.take(39).trimEnd() + "…" else it } ?: "Gasto sin detalle"

    /** Una fila de gasto (Hoy y la lista): qué fue, dónde y cómo, quién y a qué hora, y el monto. */
    fun filaDe(g: GastoDeHoy, monedas: Map<String, Moneda>, zona: ZoneId): GastoEnPantalla {
        val cuando = Instant.ofEpochMilli(g.gasto.cuandoOcurrio).atZone(zona)
        // la hora solo si es del mismo día al que cuenta (si no, parecería que pasó ese día a esa hora)
        val hora = cuando.takeIf { it.toLocalDate().toString() == g.gasto.diaImputado }?.let { "%02d:%02d".format(it.hour, it.minute) }
        val moneda = monedas[g.gasto.moneda]
        val pago = metodoDePago(g.gasto.metodoPago)
        val titulo = titulo(g)
        return GastoEnPantalla(
            id = g.gasto.id,
            emoji = g.categoria?.emoji ?: "📦",
            fondo = g.categoria?.color ?: "#EEE8D8",
            titulo = titulo,
            // el lugar (lo que identifica) y después cómo se pagó; la fila le da dos renglones para que no se pierda el pago
            detalle = listOfNotNull(g.gasto.lugar, pago).filter { it != titulo }.joinToString(" · ").ifEmpty { null },
            quien = listOfNotNull(g.autor?.let { "${it.emoji} ${it.apodo}" }, hora).joinToString(" · "),
            monto = moneda?.let { Dinero.formatear(g.gasto.montoMinor, it) } ?: "${g.gasto.moneda} ${g.gasto.montoMinor}",
            codigo = g.gasto.moneda,
            pendiente = g.gasto.sinConfirmar,
        )
    }

    /** El indicador de arriba: al día, pendientes por subir o sin conexión. */
    fun indicador(sinc: EstadoDeSincronizacion?, pendientes: Int): Pair<String, Tono> = when {
        sinc == EstadoDeSincronizacion.SinConexion -> "Sin conexión" to Tono.MAL
        sinc == EstadoDeSincronizacion.Revocado -> "Ya no estás en el viaje" to Tono.MAL
        sinc == EstadoDeSincronizacion.AppDesactualizada -> "Actualizá la app" to Tono.MAL
        sinc == EstadoDeSincronizacion.Error -> "No se pudo enviar" to Tono.MAL
        pendientes == 1 -> "1 sin enviar" to Tono.PENDIENTE
        pendientes > 1 -> "$pendientes sin enviar" to Tono.PENDIENTE
        else -> "Al día" to Tono.BIEN
    }
}
