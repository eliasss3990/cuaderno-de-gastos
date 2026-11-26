package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.ayudas.ViajeDeEjemplo
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** La pantalla Hoy del viaje de ejemplo: jueves 18 de febrero, día 4 de 14. */
class HoyTest {
    private val ej = ViajeDeEjemplo.cargar()
    private val hoy = Hoy.resumen(LectorDelViaje(ej.almacen), ViajeDeEjemplo.HOY_MS)!!

    @Test
    fun elDiaYLosTotalesContraLoPrevisto() {
        assertEquals("2027-02-18", hoy.hoy)
        assertEquals(4L to 14L, hoy.diaDelViaje to hoy.diasDelViaje)
        val t = hoy.totales.associateBy { it.moneda.codigo }
        assertEquals(listOf("BRL", "PYG"), hoy.totales.map { it.moneda.codigo })
        // ₲ 250.000 de 290.000 (86 %, rojo) y R$ 150,40 de 200,00 (75 %)
        assertEquals(ContraLimite(250_000, 290_000), t.getValue("PYG").previsto)
        assertEquals(Nivel.CERCA, t.getValue("PYG").previsto!!.nivel)
        assertEquals(ContraLimite(15_040, 20_000), t.getValue("BRL").previsto)
        assertEquals(75L to Nivel.BIEN, t.getValue("BRL").previsto!!.let { it.porcentaje to it.nivel })
    }

    @Test
    fun losUltimosGastosDeHoyConCategoriaYQuien() {
        assertTrue(hoy.ultimos.isNotEmpty())
        assertTrue(hoy.ultimos.all { it.gasto.diaImputado == "2027-02-18" && !it.gasto.eliminado })
        assertEquals(hoy.ultimos.sortedByDescending { it.gasto.cuandoOcurrio }, hoy.ultimos)
        assertTrue(hoy.ultimos.all { it.categoria != null && it.autor != null })
        // los totales salen de estos mismos gastos
        assertEquals(250_000L, hoy.ultimos.filter { it.gasto.moneda == "PYG" }.sumOf { it.gasto.montoMinor })
    }

    @Test
    fun fueraDeLasFechasNoHayNumeroDeDiaYSinViajeNoHayResumen() {
        val antes = Hoy.resumen(LectorDelViaje(ej.almacen), ViajeDeEjemplo.HOY_MS - 10L * 86_400_000)!!
        assertNull(antes.diaDelViaje)
        assertEquals(14L, antes.diasDelViaje)
        val despues = Hoy.resumen(LectorDelViaje(ej.almacen), ViajeDeEjemplo.HOY_MS + 20L * 86_400_000)!!
        assertNull(despues.diaDelViaje)
        assertNull(Hoy.resumen(LectorDelViaje(AlmacenMemoria()), ViajeDeEjemplo.HOY_MS))
    }

    @Test
    fun elDiaSeCuentaEnLaZonaDelViaje() {
        // 02:30 UTC del 19 son las 23:30 del 18 en Asunción (UTC−3): el día lo pone la zona del viaje, no UTC
        val ms = ViajeDeEjemplo.HOY_MS + 32_280_000 // 18 a las 14:32 + 8 h 58 min
        assertEquals("2027-02-18", Hoy.resumen(LectorDelViaje(ej.almacen), ms)!!.hoy)
        assertEquals("2027-02-19", Hoy.resumen(LectorDelViaje(ej.almacen), ms + 3_600_000)!!.hoy)
    }

    // un viaje armado a mano: del 2027-01-01 al 2027-01-10, en UTC
    private val marca = "0000000000064-0000-018f3a6e-0000-7000-8000-00000000000a"

    private fun viaje(tope: Long = 1_000, inicio: String = "2027-01-01"): AlmacenMemoria {
        val a = AlmacenMemoria()
        fun escribir(tipo: String, id: String, campos: Map<String, Any>) {
            a.crearEntidad(tipo, id)
            for ((k, v) in campos) a.escribirCampo(tipo, id, k, if (v is String) JsonPrimitive(v) else JsonPrimitive(v as Number), marca)
        }
        escribir("trip", "t1", mapOf("nombre" to "V", "zona_horaria" to "UTC", "fecha_inicio" to inicio, "fecha_fin" to "2027-01-10"))
        escribir("trip_currency", "PYG", mapOf("habilitada" to 1, "decimales" to 0, "simbolo" to "₲", "tope_minor" to tope))
        escribir("trip_currency", "USD", mapOf("habilitada" to 0, "decimales" to 2, "simbolo" to "US$"))
        escribir("expense", "e1", mapOf("monto_minor" to 40, "moneda" to "PYG", "categoria_id" to "otro", "cuando_ocurrio" to 1, "dia_imputado" to "2027-01-05"))
        escribir("expense", "e2", mapOf("monto_minor" to 500, "moneda" to "PYG", "categoria_id" to "otro", "cuando_ocurrio" to 2, "dia_imputado" to "2027-01-05", "eliminado" to 1))
        return a
    }

    private val cinco = 1_799_107_200_000L // 2027-01-05 00:00 UTC

    @Test
    fun laPapeleraNoCuentaHoyYLaMonedaDeshabilitadaNoAparece() {
        val r = Hoy.resumen(LectorDelViaje(viaje()), cinco)!!
        assertEquals("2027-01-05", r.hoy)
        assertEquals(listOf("PYG"), r.totales.map { it.moneda.codigo })
        assertEquals(40L, r.totales.single().gastadoMinor)
        assertEquals(listOf("e1"), r.ultimos.map { it.gasto.id })
        assertEquals(5L, r.diaDelViaje)
    }

    @Test
    fun sinPromedioPositivoNoHayBarraDeLoPrevisto() {
        // un tope tan chico que el promedio da 0 (9 ÷ 10): la barra no aparece
        assertNull(Hoy.resumen(LectorDelViaje(viaje(tope = 9)), cinco)!!.totales.single().previsto)
        assertEquals(ContraLimite(40, 100), Hoy.resumen(LectorDelViaje(viaje()), cinco)!!.totales.single().previsto)
    }

    @Test
    fun unGastoDespuesDelFinAlargaElViajeYSigueElNumeroDeDia() {
        val a = viaje()
        a.crearEntidad("expense", "e9")
        for ((k, v) in mapOf("monto_minor" to JsonPrimitive(10), "moneda" to JsonPrimitive("PYG"), "categoria_id" to JsonPrimitive("otro"), "cuando_ocurrio" to JsonPrimitive(3), "dia_imputado" to JsonPrimitive("2027-01-12"))) {
            a.escribirCampo("expense", "e9", k, v, marca)
        }
        val doce = cinco + 7L * 86_400_000
        val r = Hoy.resumen(LectorDelViaje(a), doce)!!
        assertEquals(12L to 12L, r.diaDelViaje to r.diasDelViaje)
        // sin ese gasto, el 12 queda fuera del viaje
        assertNull(Hoy.resumen(LectorDelViaje(viaje()), doce)!!.diaDelViaje)
    }

    @Test
    fun abiertoAManoSeSigueContandoPasadoElFin() {
        val a = viaje()
        a.escribirCampo("trip", "t1", "estado_manual", JsonPrimitive("EN_CURSO"), marca)
        val quince = cinco + 10L * 86_400_000
        assertEquals(15L, Hoy.resumen(LectorDelViaje(a), quince)!!.diaDelViaje)
    }

    @Test
    fun elDiaAntesDelInicioNoTieneNumeroNiSeComparaConLoPrevisto() {
        val r = Hoy.resumen(LectorDelViaje(viaje(inicio = "2027-01-06")), cinco)!!
        assertNull(r.diaDelViaje)
        // lo de hoy es preparación: hay total pero no barra
        assertEquals(40L, r.totales.single().gastadoMinor)
        assertNull(r.totales.single().previsto)
    }
}
