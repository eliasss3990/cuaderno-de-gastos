// Arma lo que muestra Hoy a partir del resumen del día (textos, montos con formato, colores): todo probado aparte.
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

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
            gastos = r.ultimos.map { g ->
                val hora = Instant.ofEpochMilli(g.gasto.cuandoOcurrio).atZone(zona).toLocalTime()
                val moneda = monedas[g.gasto.moneda]?.moneda
                GastoEnPantalla(
                    id = g.gasto.id,
                    emoji = g.categoria?.emoji ?: "📦",
                    fondo = g.categoria?.color ?: "#EEE8D8",
                    titulo = g.gasto.concepto ?: g.categoria?.nombre ?: "Gasto",
                    detalle = listOfNotNull(g.gasto.lugar, metodoDePago(g.gasto.metodoPago)).joinToString(" · ").ifEmpty { null },
                    quien = listOfNotNull(g.autor?.let { "${it.emoji} ${it.apodo}" }, "%02d:%02d".format(hora.hour, hora.minute)).joinToString(" · "),
                    monto = moneda?.let { Dinero.formatear(g.gasto.montoMinor, it) } ?: "${g.gasto.moneda} ${g.gasto.montoMinor}",
                    codigo = g.gasto.moneda,
                    pendiente = g.gasto.sinConfirmar,
                )
            },
            sincronizacion = texto,
            tono = tono,
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
