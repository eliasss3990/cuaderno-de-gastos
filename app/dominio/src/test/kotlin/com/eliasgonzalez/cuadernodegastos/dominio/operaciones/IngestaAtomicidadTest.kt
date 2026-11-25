package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ingestar una operación es todo o nada, también con los intervalos de cierre (escenarios de cierre.json). */
class IngestaAtomicidadTest {
    /** Falla en la escritura número `restantes + 1` (antes o justo después de hacerla). */
    private class AlmacenQueFalla(val base: AlmacenMemoria, val despues: Boolean) : Almacen by base {
        var restantes: Int? = null

        private fun contar(fase: Boolean) {
            val r = restantes
            if (fase != despues || r == null) return
            if (r == 0) throw IllegalStateException("falla inyectada")
            restantes = r - 1
        }

        private fun <T> envolver(f: () -> T): T {
            contar(false)
            return f().also { contar(true) }
        }

        override fun <T> transaccion(fn: () -> T): T = base.transaccion(fn)
        override fun crearEntidad(tipo: String, id: String) = envolver { base.crearEntidad(tipo, id) }
        override fun escribirCampo(tipo: String, id: String, campo: String, valor: JsonElement, hlc: String) = envolver { base.escribirCampo(tipo, id, campo, valor, hlc) }
        override fun terminar(tipo: String, id: String) = envolver { base.terminar(tipo, id) }
        override fun guardarOp(op: OpGuardada): Long = envolver { base.guardarOp(op) }
        override fun abrirIntervalo(desdeMs: Long, causa: IntervaloCierre.Causa) = envolver { base.abrirIntervalo(desdeMs, causa) }
        override fun cerrarIntervalo(hastaMs: Long) = envolver { base.cerrarIntervalo(hastaMs) }
    }

    @Test
    fun unaFallaEnCualquierEscrituraNoDejaNada() {
        var fallas = 0
        for (esc in Vectores.leer("cierre.json")["escenarios"]!!.jsonArray.map { it.jsonObject }) {
            val nombre = esc["nombre"]!!.jsonPrimitive.content
            val ops = esc["ops"]!!.jsonArray.map {
                val o = it.jsonObject
                Operacion(
                    o["opId"]!!.jsonPrimitive.content, o["tipo"]!!.jsonPrimitive.content, o["entidadTipo"]!!.jsonPrimitive.content,
                    o["entidadId"]!!.jsonPrimitive.content, o["hlc"]!!.jsonPrimitive.content, o["payload"]!!.jsonObject, o["schemaVersion"]!!.jsonPrimitive.int,
                )
            }
            val orden = esc["orden"]!!.jsonArray.map { it.jsonPrimitive.int }
            val ahoras = esc["ahoras"]!!.jsonArray.map { it.jsonPrimitive.long }
            val esperados = esc["intervalos"]!!.jsonArray.map {
                val o = it.jsonObject
                IntervaloCierre(o["desdeMs"]!!.jsonPrimitive.long, o["hastaMs"]?.takeUnless { h -> h is JsonNull }?.jsonPrimitive?.long, IntervaloCierre.Causa.valueOf(o["causa"]!!.jsonPrimitive.content))
            }
            for (despues in listOf(false, true)) {
                for (p in orden.indices) {
                    val base = AlmacenMemoria()
                    val almacen = AlmacenQueFalla(base, despues)
                    var ahora = 0L
                    val ingesta = Ingesta(almacen) { ahora }
                    fun paso(k: Int) {
                        ahora = ahoras[k]
                        ingesta.procesar(ops[orden[k]])
                    }
                    for (k in 0 until p) paso(k)
                    val antes = base.instantanea()
                    val intervalosAntes = base.intervalosDeCierre()
                    var r = 0
                    while (true) {
                        almacen.restantes = r++
                        try {
                            paso(p)
                            almacen.restantes = null
                            break
                        } catch (_: IllegalStateException) {
                            fallas++
                            almacen.restantes = null
                            assertEquals("$nombre paso $p", antes, base.instantanea())
                            assertEquals("$nombre paso $p", intervalosAntes, base.intervalosDeCierre())
                        }
                    }
                    for (k in p + 1 until orden.size) paso(k)
                    assertEquals(nombre, esperados, base.intervalosDeCierre())
                    val s = base.secuencias()
                    assertEquals(nombre, (1L..s.size).toList(), s)
                }
            }
        }
        assertTrue("fallas provocadas: $fallas", fallas > 100)
    }
}
