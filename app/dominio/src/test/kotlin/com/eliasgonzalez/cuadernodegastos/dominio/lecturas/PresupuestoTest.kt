package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.ayudas.ViajeDeEjemplo
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PresupuestoTest {
    private val ej = ViajeDeEjemplo.cargar()
    private val lector = LectorDelViaje(ej.almacen)
    private val esperado = ej.vectores["esperado"]!!.jsonObject

    private fun de(m: String, hoy: String = "2027-02-18") =
        Presupuesto.calcular(lector.viaje()!!, lector.monedas().single { it.moneda.codigo == m }, lector.gastos(), lector.gastosFijos(), hoy)

    private fun porMoneda(clave: String) = esperado[clave]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }

    @Test
    fun elViajeDeEjemploDaLoDeLasPantallas() {
        val pyg = de("PYG")
        val brl = de("BRL")
        assertEquals(porMoneda("fijos"), mapOf("PYG" to pyg.fijosMinor, "BRL" to brl.fijosMinor))
        assertEquals(porMoneda("preparacion"), mapOf("PYG" to pyg.preparacionMinor, "BRL" to brl.preparacionMinor))
        assertEquals(porMoneda("dia_a_dia"), mapOf("PYG" to pyg.variableMinor, "BRL" to brl.variableMinor))
        assertEquals(porMoneda("uso_del_tope"), mapOf("PYG" to pyg.comprometidoMinor, "BRL" to brl.comprometidoMinor))
        // promedio diario sugerido del plan del viaje: ₲ 290.000 y R$ 200,00
        assertEquals(290_000L, pyg.promedioDiarioMinor)
        assertEquals(20_000L, brl.promedioDiarioMinor)
        // uso del tope: 7.280.000 de 10.000.000 (72 %) y 3.344,00 de 5.600,00 (59 %)
        assertEquals(ContraLimite(7_280_000, 10_000_000), pyg.usoDelTope)
        assertEquals(72L to Nivel.BIEN, pyg.usoDelTope!!.let { it.porcentaje to it.nivel })
        assertEquals(59L, brl.usoDelTope!!.porcentaje)
        // ritmo al día 4: variable ÷ 4 × 14 + fijos + preparación
        assertEquals(1_340_000L * 14 / 4 + 5_760_000 + 180_000, pyg.ritmoMinor)
        assertEquals(54_400L * 14 / 4 + 280_000, brl.ritmoMinor)
    }

    @Test
    fun elRitmoRecienDesdeElSegundoDiaYElFinNoLoEstira() {
        assertNull(de("PYG", "2027-02-15").ritmoMinor)
        assertNull(de("PYG", "2027-02-10").ritmoMinor)
        val pyg = de("PYG", "2027-02-16")
        assertEquals(1_340_000L * 14 / 2 + 5_760_000 + 180_000, pyg.ritmoMinor)
        // pasado el fin, los días transcurridos no superan los del viaje
        assertEquals(1_340_000L + 5_760_000 + 180_000, de("PYG", "2027-03-10").ritmoMinor)
    }

    @Test
    fun unGastoDespuesDelFinCuentaComoUnDiaMasDelViaje() {
        // del 1 al 10, más un gasto imputado el 12: 12 días
        val g = listOf(gasto("a", 100, "2027-01-02"), gasto("b", 20, "2027-01-12"))
        assertEquals(12L, Presupuesto.diasDelViaje(base, g))
        val p = Presupuesto.calcular(base, moneda(1200), g, emptyList(), "2027-01-12")
        assertEquals(100L, p.promedioDiarioMinor)
        assertEquals(120L, p.ritmoMinor)
        // uno en la papelera no alarga
        assertEquals(10L, Presupuesto.diasDelViaje(base, listOf(gasto("x", 1, "2027-01-20", eliminado = true))))
        // sin fin no hay días
        assertNull(Presupuesto.diasDelViaje(base.copy(fechaFin = null), g))
    }

    private val base = Viaje("t", "V", "UTC", "2027-01-01", "2027-01-10", null, null)
    private fun moneda(tope: Long?) = MonedaDelPlan(Moneda("PYG", 0, "₲"), true, tope, null)
    private fun gasto(id: String, monto: Long, dia: String, eliminado: Boolean = false) =
        Gasto(id, monto, "PYG", "otro", 0, dia, null, null, null, null, null, eliminado, null, false)

    @Test
    fun sinTopeOSinFechasNoHayPromedioNiRitmoNiBarra() {
        val g = listOf(gasto("a", 100, "2027-01-02"))
        val sinTope = Presupuesto.calcular(base, moneda(null), g, emptyList(), "2027-01-05")
        assertNull(sinTope.promedioDiarioMinor)
        assertNull(sinTope.ritmoMinor)
        assertNull(sinTope.usoDelTope)
        val sinFin = Presupuesto.calcular(base.copy(fechaFin = null), moneda(1000), g, emptyList(), "2027-01-05")
        assertNull(sinFin.promedioDiarioMinor)
        assertNull(sinFin.ritmoMinor)
        // sin inicio: todo es día a día (no hay preparación)
        val sinInicio = Presupuesto.calcular(base.copy(fechaInicio = null), moneda(1000), listOf(gasto("p", 50, "2026-12-01")), emptyList(), "2027-01-05")
        assertEquals(0L to 50L, sinInicio.preparacionMinor to sinInicio.variableMinor)
    }

    @Test
    fun laPapeleraNoCuentaYElPromedioVaHaciaAbajo() {
        // (1000 − 0 − 30) ÷ 10 = 97 (97,0); con 1001 de tope: 97,1 → 97
        val g = listOf(gasto("p", 30, "2026-12-31"), gasto("x", 999, "2027-01-02", eliminado = true))
        val p = Presupuesto.calcular(base, moneda(1001), g, emptyList(), "2027-01-01")
        assertEquals(30L to 0L, p.preparacionMinor to p.variableMinor)
        assertEquals(97L, p.promedioDiarioMinor)
        // si los fijos y la preparación ya pasan el tope, no hay promedio (no es negativo)
        val fijo = GastoFijo("f", "Hotel", "PYG", 600, 2, null, null)
        assertNull(Presupuesto.calcular(base, moneda(1000), g, listOf(fijo), "2027-01-01").promedioDiarioMinor)
        assertEquals(1200L, Presupuesto.calcular(base, moneda(1000), g, listOf(fijo), "2027-01-01").fijosMinor)
    }

    @Test
    fun elNivelDelColor() {
        assertEquals(Nivel.BIEN, ContraLimite(79, 100).nivel)
        assertEquals(Nivel.CERCA, ContraLimite(80, 100).nivel)
        assertEquals(Nivel.CERCA, ContraLimite(100, 100).nivel)
        assertEquals(Nivel.SUPERADO, ContraLimite(101, 100).nivel)
        assertEquals(86L, ContraLimite(250_000, 290_000).porcentaje)
        assertEquals(-1L, ContraLimite(101, 100).restanteMinor)
        // montos enormes no desbordan
        val grande = 9_000_000_000_000_000L
        assertEquals(100L, ContraLimite(grande, grande).porcentaje)
        assertEquals(Nivel.CERCA, ContraLimite(grande / 10 * 8, grande).nivel)
    }
}
