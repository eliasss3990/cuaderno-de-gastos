package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Cola
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.ViajeLocal
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contrato de la cola local: lo cumplen el almacén en memoria y el de SQLite. */
abstract class ContratoCola {
    protected abstract fun crear(): Cola

    private fun marca(n: Int) = "${(1000 + n).toString(16).padStart(13, '0')}-0000-018f3a6e-0000-7000-8000-00000000000a"

    private fun op(n: Int, entidad: String = "e1", tipo: String = "expense") =
        OpGuardada("o$n", "$tipo.update", tipo, entidad, marca(n), JsonObject(mapOf("concepto" to JsonPrimitive("c$n"))), false, null, 1)

    private fun <T> falla(fn: () -> T) {
        try {
            fn()
        } catch (_: IllegalStateException) {
            return
        }
        throw AssertionError("no falló")
    }

    @Test
    fun loQueGuardaElMotorNaceConfirmadoSinSecuenciaYEnOrden() {
        val c = crear()
        c.guardarOp(op(1))
        c.guardarOp(op(2))
        val o = c.buscarEnCola("o1")!!
        assertEquals(EstadoOp.CONFIRMADA, o.estado)
        assertNull(o.serverSeq)
        assertEquals(0, o.intentos)
        assertTrue(o.orden < c.buscarEnCola("o2")!!.orden)
        assertNull(c.buscarEnCola("o9"))
    }

    @Test
    fun losEstadosSeFijanYSeListanEnOrden() {
        val c = crear()
        for (n in 1..5) c.guardarOp(op(n))
        c.fijarEstado("o4", EstadoOp.PENDIENTE)
        c.fijarEstado("o2", EstadoOp.PENDIENTE)
        c.fijarEstado("o3", EstadoOp.CUARENTENA, razon = "formato", dependeDe = "o2")
        c.fijarEstado("o5", EstadoOp.CONFIRMADA, serverSeq = 7)
        assertEquals(listOf("o2", "o4"), c.enEstado(EstadoOp.PENDIENTE).map { it.op.opId })
        assertEquals(listOf("o2"), c.enEstado(EstadoOp.PENDIENTE, 1).map { it.op.opId })
        val q = c.buscarEnCola("o3")!!
        assertEquals(Triple(EstadoOp.CUARENTENA, "formato", "o2"), Triple(q.estado, q.razon, q.dependeDe))
        assertEquals(7L, c.buscarEnCola("o5")!!.serverSeq)
        // dos operaciones no comparten la secuencia del servidor
        assertThrows(Exception::class.java) { c.fijarEstado("o1", EstadoOp.CONFIRMADA, serverSeq = 7) }
        c.fijarEstado("o5", EstadoOp.CONFIRMADA, serverSeq = 7) // la misma op, la misma secuencia: no pasa nada
        falla { c.fijarEstado("o9", EstadoOp.PENDIENTE) }
    }

    @Test
    fun opsDeUnaEntidadEnOrdenYConSuEstado() {
        val c = crear()
        c.guardarOp(op(1, "e1"))
        c.guardarOp(op(2, "e2"))
        c.guardarOp(op(3, "e1"))
        c.guardarOp(op(4, "e1", tipo = "fixed_cost"))
        c.fijarEstado("o3", EstadoOp.PENDIENTE)
        assertEquals(listOf("o1" to EstadoOp.CONFIRMADA, "o3" to EstadoOp.PENDIENTE), c.opsDeEntidad("expense", "e1").map { it.op.opId to it.estado })
        assertEquals(emptyList<String>(), c.opsDeEntidad("expense", "e9").map { it.op.opId })
        c.guardarOp(op(5, "a1", tipo = "attachment").copy(padreId = "e1"))
        c.guardarOp(op(6, "a2", tipo = "attachment").copy(padreId = "e2"))
        c.guardarOp(op(7, "a3", tipo = "attachment").copy(padreId = "e1"))
        assertEquals(listOf("o5", "o7"), c.opsConPadre("e1").map { it.op.opId })
        assertEquals(emptyList<String>(), c.opsConPadre("e9").map { it.op.opId })
    }

    @Test
    fun cambiarLaMarcaLiberaLaViejaYNoAceptaUnaEnUso() {
        val c = crear()
        c.guardarOp(op(1))
        c.guardarOp(op(2))
        c.cambiarMarca("o1", marca(50))
        assertEquals(marca(50), c.buscarEnCola("o1")!!.op.hlc)
        assertTrue(c.marcaEnUso(marca(50)))
        assertFalse(c.marcaEnUso(marca(1)))
        assertThrows(Exception::class.java) { c.cambiarMarca("o1", marca(2)) }
        assertEquals(marca(50), c.buscarEnCola("o1")!!.op.hlc)
    }

    @Test
    fun anotarIntentosYBorrar() {
        val c = crear()
        c.guardarOp(op(1))
        // una confirmada o en camino ya la tiene el servidor: no se descarta
        falla { c.borrarOp("o1") }
        c.fijarEstado("o1", EstadoOp.ENVIANDO)
        falla { c.borrarOp("o1") }
        c.fijarEstado("o1", EstadoOp.PENDIENTE)
        c.anotarIntento("o1", 500)
        c.anotarIntento("o1", 900)
        val o = c.buscarEnCola("o1")!!
        assertEquals(2 to 900L, o.intentos to o.proximoIntentoEn)
        c.borrarOp("o1")
        assertNull(c.buscarEnCola("o1"))
        assertFalse(c.opConocida("o1"))
        assertFalse(c.marcaEnUso(marca(1)))
        c.borrarOp("o1") // borrar lo que no está no falla
    }

    @Test
    fun unaPropiaSinConfirmarNoSeRedacta() {
        val c = crear()
        c.guardarOp(op(1))
        c.guardarOp(op(2))
        c.guardarOp(op(3, "a1", tipo = "attachment").copy(padreId = "e1"))
        c.fijarEstado("o2", EstadoOp.PENDIENTE)
        c.fijarEstado("o3", EstadoOp.CUARENTENA)
        c.redactarPorEntidad("expense", "e1")
        c.redactarPorPadre("e1")
        assertNull(c.buscarEnCola("o1")!!.op.payload)
        assertEquals(JsonObject(mapOf("concepto" to JsonPrimitive("c2"))), c.buscarEnCola("o2")!!.op.payload)
        assertEquals(JsonObject(mapOf("concepto" to JsonPrimitive("c3"))), c.buscarEnCola("o3")!!.op.payload)
    }

    @Test
    fun laRedaccionSeVeEnLaCola() {
        val c = crear()
        c.guardarOp(op(1))
        c.redactarPorEntidad("expense", "e1")
        assertNull(c.buscarEnCola("o1")!!.op.payload)
    }

    @Test
    fun unaRedaccionDentroDeUnaTransaccionQueFallaNoQuedaEnLaCola() {
        val c = crear()
        c.guardarOp(op(1))
        falla {
            c.transaccion {
                c.redactarPorEntidad("expense", "e1")
                error("falla")
            }
        }
        assertEquals(JsonObject(mapOf("concepto" to JsonPrimitive("c1"))), c.buscarEnCola("o1")!!.op.payload)
    }

    @Test
    fun borrarUnaEntidadNoDejaLapidaNiCamposYSeDeshace() {
        val c = crear()
        c.crearEntidad("expense", "e1")
        c.escribirCampo("expense", "e1", "nota", JsonPrimitive("n"), marca(1))
        falla {
            c.transaccion {
                c.borrarEntidad("expense", "e1")
                error("falla")
            }
        }
        assertEquals(JsonPrimitive("n"), c.leerCampo("expense", "e1", "nota"))
        c.borrarEntidad("expense", "e1")
        assertFalse(c.entidadExiste("expense", "e1"))
        assertFalse(c.entidadTerminada("expense", "e1"))
        assertNull(c.leerReloj("expense", "e1", "nota"))
        c.crearEntidad("expense", "e1") // se puede volver a crear y nace vacía
        assertNull(c.leerCampo("expense", "e1", "nota"))
        c.borrarEntidad("expense", "e9") // borrar lo que no existe no falla
        // quitar una lápida, también dentro de una transacción que se deshace
        c.terminar("expense", "e1")
        falla {
            c.transaccion {
                c.quitarLapida("expense", "e1")
                error("falla")
            }
        }
        assertTrue(c.entidadTerminada("expense", "e1"))
        c.quitarLapida("expense", "e1")
        assertFalse(c.entidadTerminada("expense", "e1"))
        c.quitarLapida("expense", "e9")
    }

    @Test
    fun elViajeLocalSeGuardaYSeReemplaza() {
        val c = crear()
        assertNull(c.viajeLocal())
        val v = ViajeLocal("d1", "m1", ultimoSeq = 5, desfaseMs = -30, hlcUltimo = marca(3), ultimaSyncOkEn = 99, revocado = false)
        c.guardarViajeLocal(v)
        assertEquals(v, c.viajeLocal())
        c.guardarViajeLocal(v.copy(ultimoSeq = 8, revocado = true, hlcUltimo = null))
        assertEquals(v.copy(ultimoSeq = 8, revocado = true, hlcUltimo = null), c.viajeLocal())
    }

    @Test
    fun todoLoDeLaColaSeDeshaceConLaTransaccion() {
        val c = crear()
        c.guardarOp(op(1))
        c.guardarOp(op(2))
        c.guardarViajeLocal(ViajeLocal("d1", "m1"))
        falla {
            c.transaccion {
                c.fijarEstado("o1", EstadoOp.PENDIENTE)
                c.cambiarMarca("o1", marca(70))
                c.anotarIntento("o1", 5)
                c.fijarEstado("o2", EstadoOp.CUARENTENA)
                c.borrarOp("o2")
                c.redactarPorEntidad("expense", "e1")
                c.guardarViajeLocal(ViajeLocal("d1", "m1", ultimoSeq = 9))
                error("falla")
            }
        }
        val o = c.buscarEnCola("o1")!!
        assertEquals(listOf(EstadoOp.CONFIRMADA, marca(1), 0), listOf(o.estado, o.op.hlc, o.intentos))
        assertTrue(c.opConocida("o2"))
        assertEquals(EstadoOp.CONFIRMADA, c.buscarEnCola("o2")?.estado)
        assertEquals(JsonObject(mapOf("concepto" to JsonPrimitive("c1"))), o.op.payload)
        assertTrue(c.marcaEnUso(marca(1)))
        assertFalse(c.marcaEnUso(marca(70)))
        assertEquals(0L, c.viajeLocal()!!.ultimoSeq)
    }
}
