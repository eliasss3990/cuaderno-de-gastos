package com.eliasgonzalez.cuadernodegastos.dominio.base

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ResultadoValidacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Validacion
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class IdsTest {
    @Test
    fun sonUuidV7ConLaHoraArribaYLaValidacionLosAcepta() {
        val ms = 1_802_971_920_000L
        val id = Ids.nuevo(ms)
        val u = UUID.fromString(id)
        assertEquals(7, u.version())
        assertEquals(2, u.variant())
        assertEquals(ms, u.mostSignificantBits ushr 16)
        assertEquals(id.lowercase(), id)
        val op = Operacion(Ids.nuevo(ms), "member.update", "member", id, Reloj.formatear(Hlc(ms, 0, Ids.nuevo(ms))), JsonObject(mapOf("apodo" to JsonPrimitive("Eli"))), 1)
        assertEquals(ResultadoValidacion.Ok, Validacion.validar(op))
    }

    @Test
    fun noSeRepitenYSeOrdenanPorHora() {
        val ids = (0 until 2_000).map { Ids.nuevo(1_000_000L + it / 10) }
        assertEquals(ids.size, ids.toSet().size)
        // el azar nunca pisa la versión ni la variante
        assertTrue(ids.all { UUID.fromString(it).let { u -> u.version() == 7 && u.variant() == 2 } })
        assertEquals(ids.map { it.substring(0, 13) }, ids.map { it.substring(0, 13) }.sorted())
        assertTrue(Ids.nuevo() > Ids.nuevo(1_000L))
    }

    @Test
    fun unaHoraFueraDeRangoSeRechaza() {
        assertThrows(IllegalArgumentException::class.java) { Ids.nuevo(-1) }
        assertThrows(IllegalArgumentException::class.java) { Ids.nuevo(1L shl 48) }
    }
}
