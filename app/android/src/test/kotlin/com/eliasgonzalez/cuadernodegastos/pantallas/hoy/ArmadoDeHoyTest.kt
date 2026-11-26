package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Categoria
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.ContraLimite
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.GastoDeHoy
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Integrante
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Nivel
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.ResumenDeHoy
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.TotalDeHoy
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Viaje
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.Tono
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArmadoDeHoyTest {
    private val viaje = Viaje("t", "Brasil 2027 🌴", "America/Asuncion", "2027-02-15", "2027-02-28", null, null)
    private val pyg = Moneda("PYG", 0, "₲")
    private val brl = Moneda("BRL", 2, "R$")
    private val comida = Categoria("c1", "Comida", "#FDE3D3", "🍽️", false)
    private val papa = Integrante("m1", "Papá", "#FFE2B8", "🦁", true)

    private fun gasto(id: String, monto: Long, moneda: String, cuando: Long, concepto: String?, lugar: String?, pago: String?, pendiente: Boolean = false) =
        Gasto(id, monto, moneda, "c1", cuando, "2027-02-18", concepto, lugar, pago, null, null, false, "m1", pendiente)

    @Test
    fun armaLoDelDiaConFormatoYColor() {
        val r = ResumenDeHoy(
            viaje, "2027-02-18", 4, 14,
            listOf(TotalDeHoy(pyg, 250_000, ContraLimite(250_000, 290_000)), TotalDeHoy(brl, 15_040, ContraLimite(15_040, 20_000))),
            listOf(
                // 13:48 en Asunción (UTC−3) = 16:48 UTC
                GastoDeHoy(gasto("g1", 13_750, "BRL", 1802969280000, "Almuerzo en familia", "Restaurante Do Porto", "CREDITO", pendiente = true), comida, papa),
                GastoDeHoy(gasto("g2", 15_000, "PYG", 1802949600000, null, null, "EFECTIVO"), comida, null),
            ),
        )
        val e = ArmadoDeHoy.armar(r, EstadoDeSincronizacion.AlDia, 0)
        assertEquals("HOY · JUEVES 18 DE FEBRERO", e.fecha)
        assertEquals("día 4 de 14", e.dia)
        assertEquals("Brasil 2027 🌴", e.titulo)
        assertEquals(
            listOf(TotalEnPantalla("Guaraníes", "PYG", "₲ 250.000", "Para hoy: ₲ 290.000", 86, Nivel.CERCA), TotalEnPantalla("Reales", "BRL", "R$ 150,40", "Para hoy: R$ 200,00", 75, Nivel.BIEN)),
            e.totales,
        )
        assertEquals(GastoEnPantalla("g1", "🍽️", "#FDE3D3", "Almuerzo en familia", "Restaurante Do Porto · Crédito", "🦁 Papá · 13:48", "R$ 137,50", "BRL", true), e.gastos[0])
        // sin concepto, el nombre de la categoría; sin lugar, solo el pago; sin autor, solo la hora
        assertEquals(Triple("Comida", "Efectivo", "08:20"), e.gastos[1].let { Triple(it.titulo, it.detalle, it.quien) })
        assertEquals("Al día" to Tono.BIEN, e.sincronizacion to e.tono)
    }

    @Test
    fun sinPrevistoNiNumeroDeDia() {
        val r = ResumenDeHoy(viaje.copy(fechaInicio = null), "2027-02-18", null, null, listOf(TotalDeHoy(pyg, 0, null)), emptyList())
        val e = ArmadoDeHoy.armar(r, null, 0)
        assertNull(e.dia)
        assertNull(e.totales.single().previsto)
        assertEquals("₲ 0", e.totales.single().monto)
    }

    @Test
    fun elIndicador() {
        assertEquals("Al día" to Tono.BIEN, ArmadoDeHoy.indicador(EstadoDeSincronizacion.Sincronizando, 0))
        assertEquals("1 sin enviar" to Tono.PENDIENTE, ArmadoDeHoy.indicador(EstadoDeSincronizacion.AlDia, 1))
        assertEquals("2 sin enviar" to Tono.PENDIENTE, ArmadoDeHoy.indicador(EstadoDeSincronizacion.AlDia, 2))
        assertEquals("Sin conexión" to Tono.MAL, ArmadoDeHoy.indicador(EstadoDeSincronizacion.SinConexion, 2))
        assertEquals("Ya no estás en el viaje" to Tono.MAL, ArmadoDeHoy.indicador(EstadoDeSincronizacion.Revocado, 0))
        assertEquals("No se pudo enviar" to Tono.MAL, ArmadoDeHoy.indicador(EstadoDeSincronizacion.Error, 0))
        assertEquals(Tono.MAL, ArmadoDeHoy.indicador(EstadoDeSincronizacion.AppDesactualizada, 0).second)
    }

    @Test
    fun losMetodosDePagoYLosPlurales() {
        assertEquals(listOf("Efectivo", "Crédito", "Débito", "Pix", "Transferencia o QR", "Otro", "Vale"), listOf("EFECTIVO", "CREDITO", "DEBITO", "PIX", "TRANSFERENCIA", "OTRO", "VALE").map { ArmadoDeHoy.metodoDePago(it) })
        assertNull(ArmadoDeHoy.metodoDePago(null))
        assertEquals(listOf("Guaraníes", "Reales", "USD"), listOf("PYG", "BRL", "USD").map(ArmadoDeHoy::plural))
    }
}
