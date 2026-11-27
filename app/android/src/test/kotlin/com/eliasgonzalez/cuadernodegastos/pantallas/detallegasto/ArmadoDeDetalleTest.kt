package com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto

import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Categoria
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.GastoDeHoy
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Integrante
import org.junit.Assert.assertEquals
import org.junit.Test

class ArmadoDeDetalleTest {
    private val monedas = mapOf("BRL" to Moneda("BRL", 2, "R$"))
    private val comida = Categoria("c1", "Comida", "#FDE3D3", "🍽️", false)
    private val papa = Integrante("m1", "Papá", "#FFE2B8", "🦁", true)

    // 13:48 del jueves 18 de febrero en Asunción (UTC−3)
    private fun gasto(dia: String = "2027-02-18", alias: String? = "Visa de Papá", nota: String? = null, lugar: String? = "Restaurante Do Porto") =
        Gasto("g", 13_750, "BRL", "c1", 1802969280000, dia, "Almuerzo en familia", lugar, "CREDITO", alias, nota, false, "m1", true)

    @Test
    fun losDatosDelGastoConFormato() {
        val e = ArmadoDeDetalle.armar(GastoDeHoy(gasto(), comida, papa), monedas, "America/Asuncion")
        assertEquals("R$ 137,50" to "Almuerzo en familia\u00A0· Comida", e.monto to e.subtitulo)
        assertEquals(
            listOf("Quién" to "🦁 Papá", "Día" to "Jueves 18 feb\u00A0·\u00A013:48", "Lugar" to "Restaurante Do Porto", "Pago" to "Crédito · Visa de Papá"),
            e.datos.map { it.etiqueta to it.valor },
        )
        assertEquals(true, e.pendiente)
    }

    @Test
    fun deOtroDiaDiceCuandoSeAnotoYLoQueFaltaNoAparece() {
        val e = ArmadoDeDetalle.armar(GastoDeHoy(gasto(dia = "2027-02-17", alias = null, nota = "a medias", lugar = null), null, null), monedas, "America/Asuncion")
        assertEquals(
            listOf("Día" to "Miércoles 17 feb", "Anotado" to "Jueves 18 feb\u00A0·\u00A013:48", "Pago" to "Crédito"),
            e.datos.map { it.etiqueta to it.valor },
        )
        assertEquals("a medias", e.nota)
        assertEquals("📦" to "Almuerzo en familia", e.emoji to e.subtitulo)
        // sin concepto ni lugar: el mismo nombre que en la fila
        val sinNada = gasto(lugar = null).copy(concepto = null)
        assertEquals("Gasto sin detalle", ArmadoDeDetalle.armar(GastoDeHoy(sinNada, null, null), monedas, "America/Asuncion").subtitulo)
        assertEquals("Restaurante Do Porto\u00A0· Comida", ArmadoDeDetalle.armar(GastoDeHoy(gasto().copy(concepto = null), comida, null), monedas, "America/Asuncion").subtitulo)
    }

    @Test
    fun laCategoriaOtroNoSeNombra() {
        val otro = Categoria("otro", "Otro", "#EEE8D8", "📦", false)
        assertEquals("Almuerzo en familia", ArmadoDeDetalle.armar(GastoDeHoy(gasto(), otro, papa), monedas, "America/Asuncion").subtitulo)
    }
}
