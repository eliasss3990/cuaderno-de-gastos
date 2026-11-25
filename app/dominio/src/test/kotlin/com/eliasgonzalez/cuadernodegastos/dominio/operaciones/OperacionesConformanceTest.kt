package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los mismos escenarios que pasa el servidor: el estado final no depende del orden de llegada ni de los duplicados. */
class OperacionesConformanceTest {
    private val escenarios = Vectores.leer("operaciones.json")["escenarios"]!!.jsonArray.map { it.jsonObject }

    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** La operación con tipos de Kotlin, o null si el sobre o el payload tienen otro tipo (en la app ni se puede armar). */
    private fun operacion(o: JsonObject): Operacion? = Operacion(
        texto(o["opId"]) ?: return null,
        texto(o["tipo"]) ?: return null,
        texto(o["entidadTipo"]) ?: return null,
        texto(o["entidadId"]) ?: return null,
        texto(o["hlc"]) ?: return null,
        o["payload"] as? JsonObject ?: return null,
        o["schemaVersion"]!!.jsonPrimitive.int,
    )

    private var porTipo = 0
    private val ESPERADAS_POR_TIPO = 27

    /** Aplica, o rechaza por formato lo que el tipo no deja armar (sin tocar el estado, como el servidor). */
    private fun aplicar(motor: MotorOperaciones, op: Operacion?): Resultado = op?.let { motor.aplicar(it) } ?: Resultado.Rechazada(Razon.FORMATO).also { porTipo++ }

    private fun describir(r: Resultado) = when (r) {
        is Resultado.Aceptada -> "accepted"
        Resultado.Duplicada -> "duplicate"
        is Resultado.Rechazada -> "rejected:${r.razon.codigo}"
    }

    private class Corrida(val almacen: AlmacenMemoria, val resultados: List<Resultado>)

    private fun ejecutar(ops: List<Operacion?>, orden: List<Int>): Corrida {
        val almacen = AlmacenMemoria()
        val motor = MotorOperaciones(almacen)
        return Corrida(almacen, orden.map { aplicar(motor, ops[it]) })
    }

    @Test
    fun cadaOrdenLlegaAlEstadoEsperado() {
        assertTrue(escenarios.size > 10)
        var corridas = 0
        for (esc in escenarios) {
            val nombre = esc["nombre"]!!.jsonPrimitive.content
            val ops = esc["ops"]!!.jsonArray.map { operacion(it.jsonObject) }
            val esperado = esc["esperado"]!!.jsonObject
            val ordenes = esc["ordenes"]!!.jsonArray.map { o -> o.jsonArray.map { it.jsonPrimitive.int } }
            assertTrue(nombre, ordenes.isNotEmpty())
            ordenes.forEachIndexed { k, orden ->
                val c = ejecutar(ops, orden)
                assertEquals("$nombre, orden $orden", esperado, c.almacen.instantanea())
                val aceptadas = c.resultados.filterIsInstance<Resultado.Aceptada>().map { it.seq }
                assertEquals("$nombre: secuencia sin huecos", (1L..aceptadas.size).toList(), aceptadas)
                assertEquals(nombre, aceptadas, c.almacen.secuencias())
                assertEquals(nombre, esperado["ops"]!!.jsonArray.size, aceptadas.size)
                if (k == 0) assertEquals(nombre, esc["resultados"]!!.jsonArray.map { it.jsonPrimitive.content }, c.resultados.map { describir(it) })
                corridas++
            }
            // repetir lo aceptado da duplicado; reenviar lo rechazado por formato se rechaza igual; el estado no cambia
            val orden = ordenes[0]
            val c = ejecutar(ops, orden)
            val motor = MotorOperaciones(c.almacen)
            orden.forEachIndexed { k, i ->
                when (val antes = c.resultados[k]) {
                    is Resultado.Aceptada -> assertEquals(nombre, Resultado.Duplicada, aplicar(motor, ops[i]))
                    is Resultado.Rechazada -> if (antes.razon == Razon.FORMATO) assertEquals(nombre, antes, aplicar(motor, ops[i]))
                    Resultado.Duplicada -> Unit
                }
            }
            assertEquals(nombre, esperado, c.almacen.instantanea())
        }
        assertTrue(corridas >= escenarios.size)
        // las 9 operaciones con sobre o payload de otro tipo, contando todas sus pasadas: si cambia, mirar por qué
        assertEquals("rechazadas por el tipo", ESPERADAS_POR_TIPO, porTipo)
    }
}
