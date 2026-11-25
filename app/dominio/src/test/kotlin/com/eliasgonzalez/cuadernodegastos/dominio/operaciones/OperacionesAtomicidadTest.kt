package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Aplicar es todo o nada: una falla a mitad de cualquier escritura no deja rastro. */
class OperacionesAtomicidadTest {
    private val escenarios = Vectores.leer("operaciones.json")["escenarios"]!!.jsonArray.map { it.jsonObject }

    private fun texto(e: JsonElement?) = (e as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content

    /** La operación, o null si el sobre o el payload tienen otro tipo (el tipo la rechaza sin escribir nada). */
    private fun ops(esc: JsonObject): List<Operacion?> = esc["ops"]!!.jsonArray.map {
        val o = it.jsonObject
        Operacion(
            texto(o["opId"]) ?: return@map null, texto(o["tipo"]) ?: return@map null, texto(o["entidadTipo"]) ?: return@map null,
            texto(o["entidadId"]) ?: return@map null, texto(o["hlc"]) ?: return@map null, o["payload"] as? JsonObject ?: return@map null,
            o["schemaVersion"]!!.jsonPrimitive.int,
        )
    }

    /** Falla en la escritura número `restantes + 1` (antes o después de hacerla). */
    private class AlmacenQueFalla(val base: AlmacenMemoria, val restantes: Int?, val despues: Boolean) : Almacen by base {
        var escrituras = 0
        private var quedan = restantes

        private fun contar(fase: Boolean) {
            if (fase != despues) return
            escrituras++
            val q = quedan ?: return
            if (q == 0) throw IllegalStateException("falla inyectada")
            quedan = q - 1
        }

        private fun <T> envolver(f: () -> T): T {
            contar(false)
            return f().also { contar(true) }
        }

        override fun <T> transaccion(fn: () -> T): T = base.transaccion(fn)
        override fun crearEntidad(tipo: String, id: String) = envolver { base.crearEntidad(tipo, id) }
        override fun escribirCampo(tipo: String, id: String, campo: String, valor: JsonElement, hlc: String) = envolver { base.escribirCampo(tipo, id, campo, valor, hlc) }
        override fun terminar(tipo: String, id: String) = envolver { base.terminar(tipo, id) }
        override fun redactarPorEntidad(tipo: String, id: String) = envolver { base.redactarPorEntidad(tipo, id) }
        override fun redactarPorPadre(padreId: String) = envolver { base.redactarPorPadre(padreId) }
        override fun guardarOp(op: OpGuardada): Long = envolver { base.guardarOp(op) }
    }

    @Test
    fun unaFallaAMitadNoDejaNadaEscrito() {
        var probadas = 0
        for (esc in escenarios) {
            val lista = ops(esc)
            val orden = esc["ordenes"]!!.jsonArray[0].jsonArray.map { it.jsonPrimitive.int }
            for (despues in listOf(false, true)) {
                for (paso in orden.indices) {
                    val op = lista[orden[paso]] ?: continue
                    // cuántas escrituras hace el paso, sin fallas
                    val medir = AlmacenQueFalla(AlmacenMemoria(), null, despues)
                    val m = MotorOperaciones(medir)
                    orden.take(paso).forEach { i -> lista[i]?.let { m.aplicar(it) } }
                    val antesDelPaso = medir.escrituras
                    m.aplicar(op)
                    val escrituras = medir.escrituras - antesDelPaso
                    for (falla in 0 until escrituras) {
                        val base = AlmacenMemoria()
                        val previo = MotorOperaciones(base)
                        orden.take(paso).forEach { i -> lista[i]?.let { previo.aplicar(it) } }
                        val antes = base.instantanea()
                        val conFalla = MotorOperaciones(AlmacenQueFalla(base, falla, despues))
                        try {
                            conFalla.aplicar(op)
                            throw AssertionError("no falló")
                        } catch (_: IllegalStateException) {
                        }
                        assertEquals("${esc["nombre"]} paso $paso falla $falla", antes, base.instantanea())
                        // y después se puede aplicar igual que si nada hubiera pasado
                        val r = previo.aplicar(op)
                        // la secuencia tampoco queda corrida: sigue sin huecos
                        val seqs = base.secuencias()
                        assertEquals("${esc["nombre"]} paso $paso falla $falla", (1L..seqs.size).toList(), seqs)
                        if (r is Resultado.Aceptada) assertEquals(seqs.size.toLong(), r.seq)
                        probadas++
                    }
                }
            }
        }
        assertTrue(probadas > 100)
        // las 9 que el tipo no deja armar, una vez cada una
        assertEquals(9, escenarios.sumOf { e -> ops(e).count { it == null } })
    }
}
