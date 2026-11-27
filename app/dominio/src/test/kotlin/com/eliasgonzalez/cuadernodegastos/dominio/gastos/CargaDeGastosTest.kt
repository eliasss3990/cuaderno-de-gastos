package com.eliasgonzalez.cuadernodegastos.dominio.gastos

import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Validacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ResultadoValidacion
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CargaDeGastosTest {
    private val marca = "0018bcfe56801-0001-018f3a6e-0000-7000-8000-00000000000a"
    private val op = "018f3a6e-9000-7000-8000-000000000001"
    private val id = "018f3a6e-2000-7000-8000-000000000001"

    private fun gasto(
        id: String = this.id, moneda: String = "BRL", categoria: String = "c1", autor: String? = "yo", metodo: String? = "PIX",
        eliminado: Boolean = false, lugar: String? = null, cuando: Long = 1_000,
    ) = Gasto(id, 1000, moneda, categoria, cuando, "2027-02-18", null, lugar, metodo, null, null, eliminado, autor, false)

    private val borrador = BorradorDeGasto(13750, "BRL", "otro", 1_802_971_920_000, "2027-02-18")

    @Test
    fun sinGastosArrancaConLaPrimeraMonedaOtroYHoyEnLaZonaDelViaje() {
        // 1_802_971_920_000 = 2027-02-18 13:52 en Asunción (UTC−3)
        val d = CargaDeGastos.porDefecto(emptyList(), listOf("PYG", "BRL"), emptySet(), "yo", "America/Asuncion", 1_802_971_920_000)
        assertEquals(ValoresPorDefecto("PYG", "otro", null, "2027-02-18"), d)
    }

    @Test
    fun usaLoDelUltimoGastoPropioYSiNoHayElDeCualquiera() {
        val gastos = listOf(gasto("a", "PYG", "c2", autor = "otra", metodo = "EFECTIVO"), gasto("b", "BRL", "c1", autor = "yo", metodo = "PIX"))
        val d = CargaDeGastos.porDefecto(gastos, listOf("PYG", "BRL"), setOf("c1", "c2"), "yo", "America/Asuncion", 0)
        assertEquals(Triple("BRL", "c1", "PIX"), Triple(d.moneda, d.categoriaId, d.metodoPago))
        val ajeno = CargaDeGastos.porDefecto(gastos, listOf("PYG", "BRL"), setOf("c1", "c2"), "nuevo", "America/Asuncion", 0)
        assertEquals("PYG", ajeno.moneda)
    }

    @Test
    fun sinSaberQuienSoyNoTomaUnGastoDeAutorDesconocidoComoPropio() {
        val gastos = listOf(gasto("a", "PYG", autor = "otra"), gasto("b", "BRL", autor = null))
        assertEquals("PYG", CargaDeGastos.porDefecto(gastos, listOf("PYG", "BRL"), emptySet(), null, "America/Asuncion", 0).moneda)
    }

    @Test
    fun noProponeUnaMonedaDeshabilitadaNiUnaCategoriaArchivadaNiLoDeLaPapelera() {
        val d = CargaDeGastos.porDefecto(listOf(gasto(moneda = "EUR", categoria = "vieja")), listOf("PYG"), setOf("c1"), "yo", "America/Asuncion", 0)
        assertEquals("PYG" to "otro", d.moneda to d.categoriaId)
        val papelera = CargaDeGastos.porDefecto(listOf(gasto(eliminado = true)), listOf("PYG", "BRL"), setOf("c1"), "yo", "America/Asuncion", 0)
        assertEquals("PYG" to null, papelera.moneda to papelera.metodoPago)
    }

    @Test
    fun elAltaLlevaSoloLoCompletoYPasaLaValidacionDeFormato() {
        val o = CargaDeGastos.alta(borrador.copy(concepto = "  Almuerzo ", lugar = " ", metodoPago = "EFECTIVO", aliasTarjeta = "Visa", nota = ""), op, id, marca)
        assertEquals(setOf("monto_minor", "moneda", "categoria_id", "cuando_ocurrio", "dia_imputado", "concepto", "metodo_pago"), o.payload.keys)
        assertEquals(JsonPrimitive("Almuerzo"), o.payload["concepto"])
        assertEquals("expense.create" to id, o.tipo to o.entidadId)
        assertEquals(ResultadoValidacion.Ok, Validacion.validar(o))
    }

    @Test
    fun elAliasSoloVaConTarjeta() {
        val o = CargaDeGastos.alta(borrador.copy(metodoPago = "CREDITO", aliasTarjeta = "Visa de Papá"), op, id, marca)
        assertEquals(JsonPrimitive("Visa de Papá"), o.payload["alias_tarjeta"])
    }

    @Test
    fun laEdicionMandaSoloLoQueCambioYBorraLoQueSeVacio() {
        val antes = gasto(lugar = "Do Porto", cuando = 1_802_971_920_000).copy(montoMinor = 13750, categoriaId = "otro", metodoPago = null)
        assertNull(CargaDeGastos.edicion(antes, borrador.copy(lugar = "Do Porto "), op, marca))
        val o = CargaDeGastos.edicion(antes, borrador.copy(montoMinor = 14000, lugar = ""), op, marca)!!
        assertEquals(mapOf("monto_minor" to JsonPrimitive(14000), "moneda" to JsonPrimitive("BRL"), "lugar" to JsonNull), o.payload.toMap())
        assertEquals("expense.update" to antes.id, o.tipo to o.entidadId)
        assertEquals(ResultadoValidacion.Ok, Validacion.validar(o))
    }

    @Test
    fun lasSugerenciasSonDistintasRecientesYSinLaPapelera() {
        val gastos = listOf(
            gasto("a", lugar = "Do Porto"), gasto("b", lugar = "do porto"), gasto("c", lugar = "Churrascaria Rio"),
            gasto("d", lugar = "Viejo", eliminado = true), gasto("e", lugar = null),
        )
        assertEquals(listOf("Do Porto", "Churrascaria Rio"), CargaDeGastos.sugerencias(gastos, { it.lugar }))
        assertEquals(1, CargaDeGastos.sugerencias(gastos, { it.lugar }, cuantos = 1).size)
    }

    @Test
    fun laEdicionNoTocaCuandoOcurrioYLaMonedaViajaConElMonto() {
        val antes = gasto(cuando = 1_000).copy(montoMinor = 13750, categoriaId = "otro", metodoPago = null)
        val mismo = borrador.copy(cuandoOcurrio = 1_000)
        // otra hora en el borrador (la de ahora) no se manda: no pisa cuándo ocurrió
        assertNull(CargaDeGastos.edicion(antes, mismo.copy(cuandoOcurrio = 99_999), op, marca))
        assertEquals(setOf("monto_minor", "moneda"), CargaDeGastos.edicion(antes, mismo.copy(moneda = "PYG"), op, marca)!!.payload.keys)
        assertEquals(setOf("categoria_id"), CargaDeGastos.edicion(antes, mismo.copy(categoriaId = "c9"), op, marca)!!.payload.keys)
    }

    @Test
    fun pasarDeTarjetaAEfectivoBorraElAliasYUnAliasViejoSinTarjetaNoCuentaComoCambio() {
        val conTarjeta = gasto(cuando = 1_000).copy(montoMinor = 13750, categoriaId = "otro", metodoPago = "CREDITO", aliasTarjeta = "Visa")
        val b = borrador.copy(cuandoOcurrio = 1_000, metodoPago = "EFECTIVO", aliasTarjeta = "Visa")
        assertEquals(mapOf("metodo_pago" to JsonPrimitive("EFECTIVO"), "alias_tarjeta" to JsonNull), CargaDeGastos.edicion(conTarjeta, b, op, marca)!!.payload.toMap())
        val viejo = conTarjeta.copy(metodoPago = "EFECTIVO")
        assertNull(CargaDeGastos.edicion(viejo, b, op, marca))
    }

    @Test
    fun elUltimoGastoSeBuscaPorCuandoOcurrioAunqueLaListaVengaDesordenada() {
        val gastos = listOf(gasto("viejo", "PYG", cuando = 1_000), gasto("nuevo", "BRL", cuando = 5_000))
        assertEquals("BRL", CargaDeGastos.porDefecto(gastos, listOf("PYG", "BRL"), setOf("c1"), "yo", "America/Asuncion", 0).moneda)
    }

    @Test
    fun deshacerElAltaEsUnaPurgaValida() {
        val o = CargaDeGastos.deshacerAlta(id, op, marca)
        assertEquals("expense.purge" to id, o.tipo to o.entidadId)
        assertEquals(ResultadoValidacion.Ok, Validacion.validar(o))
    }

    @Test
    fun loGastadoPorMonedaNoCuentaLaPapelera() {
        val gastos = listOf(gasto("a", "BRL").copy(montoMinor = 1_000), gasto("b", "BRL").copy(montoMinor = 500), gasto("c", "BRL", eliminado = true).copy(montoMinor = 9_000), gasto("d", "PYG"))
        assertEquals(mapOf("BRL" to 1_500L, "PYG" to 1_000L), CargaDeGastos.gastadoPorMoneda(gastos))
    }

    @Test
    fun elAvisoDistingueYaPasadoDePasaConEsteGasto() {
        assertEquals(AvisoDelTope.NINGUNO, CargaDeGastos.avisoDelTope(2_000, 8_000, 10_000))
        assertEquals(AvisoDelTope.PASA_CON_ESTE, CargaDeGastos.avisoDelTope(2_001, 8_000, 10_000))
        // justo en el tope todavía no está pasado: el que lo pase es este gasto
        assertEquals(AvisoDelTope.PASA_CON_ESTE, CargaDeGastos.avisoDelTope(1, 10_000, 10_000))
        // ya pasado: aunque el monto esté vacío
        assertEquals(AvisoDelTope.YA_PASADO, CargaDeGastos.avisoDelTope(0, 10_001, 10_000))
        assertEquals(AvisoDelTope.NINGUNO, CargaDeGastos.avisoDelTope(10_000_000, 0, null))
        assertEquals(AvisoDelTope.NINGUNO, CargaDeGastos.avisoDelTope(5, 0, 0))
    }

    @Test
    fun lasSugerenciasSonLasMasRecientesAunqueLaListaVengaDeMasViejoAMasNuevo() {
        val gastos = (1..7).map { gasto("g$it", lugar = "Lugar $it", cuando = it * 1_000L) }
        assertEquals(listOf("Lugar 7", "Lugar 6", "Lugar 5", "Lugar 4", "Lugar 3"), CargaDeGastos.sugerencias(gastos, { it.lugar }))
    }

    @Test
    fun pasadoElFinElDiaPropuestoEsElUltimoDelViaje() {
        // hoy 2027-02-18 en Asunción
        val d = CargaDeGastos.porDefecto(emptyList(), listOf("PYG"), emptySet(), "yo", "America/Asuncion", 1_802_971_920_000, fechaFin = "2027-02-10")
        assertEquals("2027-02-10", d.diaImputado)
        assertEquals("2027-02-18", CargaDeGastos.porDefecto(emptyList(), listOf("PYG"), emptySet(), "yo", "America/Asuncion", 1_802_971_920_000, fechaFin = "2027-02-28").diaImputado)
    }

    @Test
    fun papeleraYRestaurarSonOperacionesValidas() {
        val id = "018f3a6e-2000-7000-8000-000000000001"
        val p = CargaDeGastos.aLaPapelera(id, "018f3a6e-9000-7000-8000-000000000001", marca)
        val r = CargaDeGastos.restaurar(id, "018f3a6e-9000-7000-8000-000000000002", marca)
        assertEquals(listOf("expense.delete", "expense.restore"), listOf(p.tipo, r.tipo))
        assertEquals(listOf("1", "0"), listOf(p, r).map { it.payload!!["eliminado"].toString() })
        for (o in listOf(p, r)) assertEquals(com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ResultadoValidacion.Ok, com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Validacion.validar(o))
    }

    @Test
    fun siCambiaElMontoOLaMonedaViajanLosDos() {
        val g = com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto("018f3a6e-2000-7000-8000-000000000001", 500, "BRL", "otro", 1, "2027-02-18", null, "Do Porto", null, null, null, false, null, false)
        val b = BorradorDeGasto(500, "USD", "otro", 2, "2027-02-18", "", "Do Porto", null, "", "")
        val o = CargaDeGastos.edicion(g, b, "018f3a6e-9000-7000-8000-000000000001", marca)!!
        assertEquals(setOf("monto_minor", "moneda"), o.payload!!.keys)
        // otro campo solo, viaja solo
        val l = CargaDeGastos.edicion(g, b.copy(moneda = "BRL", lugar = "Otro lugar"), "018f3a6e-9000-7000-8000-000000000002", marca)!!
        assertEquals(setOf("lugar"), l.payload!!.keys)
    }

    @Test
    fun conCamposAplicaSoloLosCamposDados() {
        val g = Gasto("018f3a6e-2000-7000-8000-000000000001", 500, "BRL", "otro", 1, "2027-02-18", "c", "Do Porto", "CREDITO", "Visa", "n", false, null, false)
        val b = BorradorDeGasto(900, "PYG", "c9", 2, "2027-02-17", " ", "  Otro lugar ", "EFECTIVO", "Visa", "nota")
        val r = CargaDeGastos.conCampos(g, b, setOf("monto_minor", "moneda", "lugar", "concepto", "alias_tarjeta"))
        // lo pedido se toma limpio (vacío = sin dato; el alias sin tarjeta no va), lo demás queda
        assertEquals(listOf<Any?>(900L, "PYG", "otro", "2027-02-18", null, "Otro lugar", "CREDITO", null, "n"), listOf(r.montoMinor, r.moneda, r.categoriaId, r.diaImputado, r.concepto, r.lugar, r.metodoPago, r.aliasTarjeta, r.nota))
        // lo que no se pide queda como estaba
        assertEquals("c" to "n", CargaDeGastos.conCampos(g, b, setOf("lugar")).let { it.concepto to it.nota })
        // aplicar lo que manda una edición deja al gasto igual al borrador (no queda nada por mandar)
        val todo = CargaDeGastos.edicion(g, b, "op", "m")!!.payload.keys
        assertEquals(null, CargaDeGastos.edicion(CargaDeGastos.conCampos(g, b, todo), b, "op", "m"))
    }
}
