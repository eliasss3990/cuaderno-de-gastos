package com.eliasgonzalez.cuadernodegastos.pantallas.gastos

import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Categoria
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.DiaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.GastoDeHoy
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.GastosDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Integrante
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Viaje
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.Tono
import org.junit.Assert.assertEquals
import org.junit.Test

class ArmadoDeGastosTest {
    private val viaje = Viaje("t", "Brasil", "America/Asuncion", "2027-02-15", "2027-02-28", null, null)
    private val monedas = mapOf("PYG" to Moneda("PYG", 0, "₲"), "BRL" to Moneda("BRL", 2, "R$"))
    private val comida = Categoria("c1", "Comida", "#FDE3D3", "🍽️", false)
    private val papa = Integrante("m1", "Papá", "#FFE2B8", "🦁", true)

    private fun g(id: String, monto: Long, moneda: String, dia: String) =
        GastoDeHoy(Gasto(id, monto, moneda, "c1", 1802969280000, dia, "Almuerzo", "Do Porto", "CREDITO", null, null, false, "m1", false), comida, papa)

    @Test
    fun cadaDiaConSuTituloYSuTotalPorMoneda() {
        val e = ArmadoDeGastos.armar(
            GastosDelViaje(
                viaje,
                listOf(DiaDeGastos("2027-02-18", mapOf("BRL" to 15_040, "PYG" to 250_000), listOf(g("a", 13_750, "BRL", "2027-02-18")))),
                listOf(DiaDeGastos("2027-01-03", mapOf("PYG" to 1_500_000), listOf(g("b", 1_500_000, "PYG", "2027-01-03")))),
            ),
            monedas, EstadoDeSincronizacion.SinConexion, 0,
        )
        assertEquals(false, e.cargando)
        assertEquals(listOf("JUEVES 18 FEB" to "R$ 150,40 · ₲ 250.000"), e.delViaje.map { it.titulo to it.totales })
        assertEquals(listOf("DOMINGO 3 ENE" to "₲ 1.500.000"), e.preparacion.map { it.titulo to it.totales })
        assertEquals("R$ 137,50", e.delViaje.single().gastos.single().monto)
        assertEquals("Sin conexión" to Tono.MAL, e.sincronizacion to e.tono)
    }

    @Test
    fun unaMonedaQueYaNoEstaSeMuestraConSuCodigo() {
        val e = ArmadoDeGastos.armar(GastosDelViaje(viaje, listOf(DiaDeGastos("2027-02-16", mapOf("USD" to 500), emptyList())), emptyList()), monedas, null, 0)
        assertEquals("USD 500", e.delViaje.single().totales)
    }

    @Test
    fun hoyYAyerSeNombranYLaPreparacionSeSuma() {
        val e = ArmadoDeGastos.armar(
            GastosDelViaje(
                viaje,
                listOf(DiaDeGastos("2027-02-18", mapOf("BRL" to 100), emptyList()), DiaDeGastos("2027-02-17", mapOf("BRL" to 100), emptyList()), DiaDeGastos("2027-02-16", mapOf("BRL" to 1), emptyList())),
                listOf(DiaDeGastos("2027-02-01", mapOf("PYG" to 1_000, "BRL" to 50), emptyList()), DiaDeGastos("2027-01-03", mapOf("PYG" to 500), emptyList())),
            ),
            monedas, null, 0, hoy = "2027-02-18",
        )
        assertEquals(listOf("HOY · JUEVES 18 FEB", "AYER · MIÉRCOLES 17 FEB", "MARTES 16 FEB"), e.delViaje.map { it.titulo })
        assertEquals("15 feb" to "R$ 0,50 · ₲ 1.500", e.antesDe to e.totalPreparacion)
    }
}
