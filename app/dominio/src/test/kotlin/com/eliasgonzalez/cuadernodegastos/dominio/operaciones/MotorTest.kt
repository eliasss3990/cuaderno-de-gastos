package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Casos del motor que los escenarios no cubren. */
class MotorTest {
    private val disp = "018f3a6e-0000-7000-8000-00000000000a"
    private var n = 0

    private fun op(tipo: String, entidadTipo: String, id: String, payload: String): Operacion {
        n++
        return Operacion("018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", tipo, entidadTipo, id, "%013x-0000-$disp".format(100 + n), Json.parseToJsonElement(payload).jsonObject, 1)
    }

    @Test
    fun unErrorQueNoEsExceptionTambienDeshaceYNoDejaLaTransaccionAbierta() {
        val almacen = AlmacenMemoria()
        val antes = almacen.instantanea()
        try {
            almacen.transaccion {
                almacen.crearEntidad("expense", "e1")
                throw AssertionError("falla")
            }
        } catch (_: AssertionError) {
        }
        assertEquals(antes, almacen.instantanea())
        // la siguiente transacción vuelve a ser propia: si falla, también se deshace
        try {
            almacen.transaccion {
                almacen.crearEntidad("expense", "e2")
                throw IllegalStateException("falla")
            }
        } catch (_: IllegalStateException) {
        }
        assertEquals(antes, almacen.instantanea())
    }

    @Test
    fun unAdjuntoConDuenoVacioEsFormatoNoInexistente() {
        val motor = MotorOperaciones(AlmacenMemoria())
        val r = motor.aplicar(op("attachment.add", "attachment", "018f3a6e-a000-7000-8000-000000000001", """{"owner_tipo":"EXPENSE","owner_id":"","mime":"image/png","bytes":1,"sha256":"h","tiene_miniatura":0}"""))
        assertEquals(Resultado.Rechazada(Razon.FORMATO), r)
    }
}
