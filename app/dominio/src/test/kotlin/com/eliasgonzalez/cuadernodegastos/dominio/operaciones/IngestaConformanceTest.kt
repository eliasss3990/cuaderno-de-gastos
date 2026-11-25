package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.ayudas.Vectores
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Los mismos escenarios de ingesta y de cierre del viaje que pasa el servidor. */
class IngestaConformanceTest {
    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun operacion(o: JsonObject) = Operacion(
        texto(o["opId"])!!, texto(o["tipo"])!!, texto(o["entidadTipo"])!!, texto(o["entidadId"])!!, texto(o["hlc"])!!,
        o["payload"]!!.jsonObject, o["schemaVersion"]!!.jsonPrimitive.int,
    )

    private fun describir(r: Resultado) = when (r) {
        is Resultado.Aceptada -> "accepted"
        Resultado.Duplicada -> "duplicate"
        is Resultado.Rechazada -> "rejected:${r.razon.codigo}"
    }

    private fun lista(e: JsonElement?) = e!!.jsonArray

    @Test
    fun ingesta() {
        val escenarios = Vectores.leer("ingesta.json")["escenarios"]!!.jsonArray.map { it.jsonObject }
        assertTrue(escenarios.size >= 10)
        for (esc in escenarios) {
            val nombre = esc["nombre"]!!.jsonPrimitive.content
            val ops = lista(esc["ops"]).map { operacion(it.jsonObject) }
            val orden = lista(esc["orden"]).map { it.jsonPrimitive.int }
            val esperados = lista(esc["resultados"]).map { it.jsonPrimitive.content }
            assertEquals(nombre, orden.size, esperados.size)
            val almacen = AlmacenMemoria()
            val ingesta = Ingesta(almacen)
            assertEquals(nombre, esperados, orden.map { describir(ingesta.procesar(ops[it])) })
            val aceptadas = esperados.count { it == "accepted" }
            assertEquals(nombre, (1L..aceptadas).toList(), almacen.secuencias())
            val entidades = almacen.instantanea()["entidades"]!!.jsonArray.map { it.jsonObject["tipo"]!!.jsonPrimitive.content }
            esc["cuentas"]?.jsonObject?.forEach { (tipo, n) -> assertEquals("$nombre: $tipo", n.jsonPrimitive.int, entidades.count { it == tipo }) }
        }
    }

    @Test
    fun cierre() {
        val escenarios = Vectores.leer("cierre.json")["escenarios"]!!.jsonArray.map { it.jsonObject }
        assertTrue(escenarios.size >= 8)
        for (esc in escenarios) {
            val nombre = esc["nombre"]!!.jsonPrimitive.content
            val ops = lista(esc["ops"]).map { operacion(it.jsonObject) }
            val orden = lista(esc["orden"]).map { it.jsonPrimitive.int }
            val ahoras = lista(esc["ahoras"]).map { it.jsonPrimitive.long }
            val esperados = lista(esc["resultados"]).map { it.jsonPrimitive.content }
            assertEquals(nombre, orden.size, ahoras.size)
            assertEquals(nombre, orden.size, esperados.size)
            val almacen = AlmacenMemoria()
            var ahora = 0L
            val ingesta = Ingesta(almacen) { ahora }
            val obtenidos = orden.mapIndexed { k, i ->
                ahora = ahoras[k]
                describir(ingesta.procesar(ops[i]))
            }
            assertEquals(nombre, esperados, obtenidos)
            val intervalos = lista(esc["intervalos"]).map {
                val o = it.jsonObject
                IntervaloCierre(o["desdeMs"]!!.jsonPrimitive.long, o["hastaMs"]?.takeUnless { h -> h is JsonNull }?.jsonPrimitive?.long, IntervaloCierre.Causa.valueOf(o["causa"]!!.jsonPrimitive.content))
            }
            assertEquals(nombre, intervalos, almacen.intervalosDeCierre())
        }
    }
}
