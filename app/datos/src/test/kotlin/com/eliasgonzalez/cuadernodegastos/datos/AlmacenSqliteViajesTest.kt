package com.eliasgonzalez.cuadernodegastos.datos

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.IntervaloCierre
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Dos viajes en la misma base no se ven entre sí: todo va acotado al viaje del almacén. */
class AlmacenSqliteViajesTest {
    private val marca1 = "0000000000064-0000-018f3a6e-0000-7000-8000-00000000000a"
    private val marca2 = "00000000000c8-0000-018f3a6e-0000-7000-8000-00000000000a"

    private fun op(opId: String, hlc: String, padre: String? = null) =
        OpGuardada(opId, "attachment.add", "attachment", "a1", hlc, JsonObject(mapOf("x" to JsonPrimitive(1))), false, padre, 1)

    @Test
    fun cadaViajeVeSoloLoSuyo() {
        BaseJdbc().use { b ->
            Migraciones.aplicar(b)
            val uno = AlmacenSqlite(b, "v1")
            val dos = AlmacenSqlite(b, "v2")
            uno.crearEntidad("trip", "t1")
            uno.crearEntidad("attachment", "a1")
            uno.escribirCampo("attachment", "a1", "owner_id", JsonPrimitive("e1"), marca1)
            uno.terminar("expense", "e9")
            uno.abrirIntervalo(10, IntervaloCierre.Causa.MANUAL)
            assertEquals(1L, uno.guardarOp(op("o1", marca1, "e1")))
            assertEquals(2L, uno.guardarOp(op("o2", marca2)))

            // la misma operación y la misma marca pueden existir en otro viaje, con su propia secuencia
            assertFalse(dos.opConocida("o1"))
            assertFalse(dos.marcaEnUso(marca1))
            assertEquals(1L, dos.guardarOp(op("o1", marca1)))
            assertEquals(listOf(1L), dos.secuencias())
            assertEquals(listOf(1L, 2L), uno.secuencias())

            assertNull(dos.idDelViaje())
            assertFalse(dos.entidadExiste("attachment", "a1"))
            assertNull(dos.leerCampo("attachment", "a1", "owner_id"))
            assertNull(dos.leerReloj("attachment", "a1", "owner_id"))
            assertEquals(emptyList<String>(), dos.adjuntosDe("e1"))
            assertEquals(0, dos.contarEntidades("attachment"))
            assertFalse(dos.entidadTerminada("expense", "e9"))
            assertEquals(emptyList<IntervaloCierre>(), dos.intervalosDeCierre())
            assertNull(dos.padreRegistrado("attachment", "a1"))
            dos.abrirIntervalo(5, IntervaloCierre.Causa.FECHAS) // el abierto de v1 no le impide abrir uno

            // redactar o terminar en un viaje no toca al otro
            dos.redactarPorPadre("e1")
            dos.redactarPorEntidad("attachment", "a1")
            dos.terminar("attachment", "a1")
            dos.borrarOp("o2") // o2 es de v1: no se toca
            assertTrue(uno.opConocida("o2"))
            assertTrue(uno.entidadExiste("attachment", "a1"))
            assertEquals("e1", uno.padreRegistrado("attachment", "a1"))
            assertTrue(uno.instantanea().toString().contains("\"redactada\":false"))
            assertEquals("t1", uno.idDelViaje())
            assertEquals(listOf(IntervaloCierre(10, null, IntervaloCierre.Causa.MANUAL)), uno.intervalosDeCierre())
        }
    }
}
