package com.eliasgonzalez.cuadernodegastos.red

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Recepcion
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Ciclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.ViajeLocal
import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.InetSocketAddress

/**
 * Dos celulares sincronizan por HTTP de verdad (el cliente de la app contra un servidor HTTP de prueba que usa la misma
 * recepción que el servidor real, con el mismo formato del cable) y terminan con el mismo estado que el servidor.
 */
class CicloPorHttpTest {
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"
    private var hora = 1_802_000_000_000L
    private val almacen = AlmacenMemoria()
    private val recepcion = Recepcion(almacen) { hora }
    private val tokens = mapOf("t-a" to "018f3a6e-0000-7000-8000-00000000000a", "t-b" to "018f3a6e-0000-7000-8000-00000000000b")

    private val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/v1/trips/$viaje/") { x ->
            val dispositivo = tokens[x.requestHeaders.getFirst("Authorization")?.removePrefix("Bearer ")]
            val (estado, cuerpo) = when {
                dispositivo == null -> 401 to """{"error":{"codigo":"no_autorizado","mensaje":"no"}}"""
                x.requestMethod == "POST" -> {
                    val ops = Json.parseToJsonElement(x.requestBody.readBytes().toString(Charsets.UTF_8)).jsonObject["ops"]!!.jsonArray.map { it.jsonObject }.map {
                        Operacion(it["op_id"]!!.jsonPrimitive.content, it["type"]!!.jsonPrimitive.content, it["entity_type"]!!.jsonPrimitive.content, it["entity_id"]!!.jsonPrimitive.content, it["hlc"]!!.jsonPrimitive.content, it["payload"]!!.jsonObject, it["schema_version"]!!.jsonPrimitive.int)
                    }
                    val res = recepcion.procesarLote(ops, dispositivo).map { r ->
                        JsonObject(
                            buildMap {
                                put("op_id", JsonPrimitive(r.opId))
                                put("estado", JsonPrimitive(r.estado.name.let { mapOf("ACEPTADA" to "accepted", "DUPLICADA" to "duplicate", "RECHAZADA" to "rejected").getValue(it) }))
                                r.seq?.let { put("server_seq", JsonPrimitive(it)) }
                                r.razon?.let { put("razon", JsonPrimitive(it.codigo)) }
                                put("hlc", JsonPrimitive(r.hlc))
                            },
                        )
                    }
                    200 to JsonObject(mapOf("resultados" to JsonArray(res))).toString()
                }
                else -> {
                    val q = x.requestURI.query.split("&").associate { it.substringBefore("=") to it.substringAfter("=").toLong() }
                    val todas = almacen.opsDesde(q.getValue("after"), Int.MAX_VALUE)
                    val pagina = todas.take(minOf(q.getValue("limit").toInt(), 4))
                    val ops = pagina.map {
                        JsonObject(
                            mapOf(
                                "server_seq" to JsonPrimitive(it.seq), "op_id" to JsonPrimitive(it.op.opId), "type" to JsonPrimitive(it.op.tipo),
                                "entity_type" to JsonPrimitive(it.op.entidadTipo), "entity_id" to JsonPrimitive(it.op.entidadId), "hlc" to JsonPrimitive(it.op.hlc),
                                "payload" to (it.op.payload ?: JsonNull), "redacted" to JsonPrimitive(it.op.redactada), "schema_version" to JsonPrimitive(it.op.schemaVersion),
                                "padre_id" to (it.op.padreId?.let { p -> JsonPrimitive(p) } ?: JsonNull),
                            ),
                        )
                    }
                    200 to JsonObject(mapOf("ops" to JsonArray(ops), "hay_mas" to JsonPrimitive(todas.size > pagina.size), "ahora" to JsonPrimitive(hora))).toString()
                }
            }
            val b = cuerpo.toByteArray()
            x.sendResponseHeaders(estado, b.size.toLong())
            x.responseBody.use { it.write(b) }
            x.close()
        }
        start()
    }

    @After
    fun cerrar() = http.stop(0)

    private fun json(s: String) = Json.parseToJsonElement(s).jsonObject

    private inner class Celular(token: String, val dispositivo: String) {
        val cola = AlmacenMemoria().also { it.guardarViajeLocal(ViajeLocal(dispositivo, "m")) }
        val sinc = Sincronizador(cola) { hora }
        val ciclo = Ciclo(sinc, cola, ClienteHttp("http://127.0.0.1:${http.address.port}", viaje, { token }, "1.0.0", { EstadoDelCelular(cola.viajeLocal()!!.ultimoSeq, cola.enEstado(EstadoOp.PENDIENTE).size) }), { hora })
    }

    @Test
    fun dosCelularesPorHttpQuedanIgualesAlServidor() {
        recepcion.procesarLote(listOf(Operacion("018f3a6e-9000-7000-8000-000000000000", "trip.create", "trip", viaje, Reloj.formatear(Hlc(hora - 1000, 0, tokens.getValue("t-a"))), json("""{"nombre":"V","zona_horaria":"America/Asuncion","monedas":[{"codigo":"PYG","decimales":0,"simbolo":"₲"}]}"""), 1)), tokens.getValue("t-a"))
        val a = Celular("t-a", tokens.getValue("t-a"))
        val b = Celular("t-b", tokens.getValue("t-b"))
        assertEquals(FinDelCiclo.AlDia, a.ciclo.correr())
        assertEquals(FinDelCiclo.AlDia, b.ciclo.correr())
        var n = 0
        for ((cel, cuantos) in listOf(a to 7, b to 5)) {
            repeat(cuantos) {
                n++
                val id = "018f3a6e-2000-7000-8000-${n.toString().padStart(12, '0')}"
                cel.sinc.registrar(Operacion("018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", "expense.create", "expense", id, cel.sinc.nuevaMarca(), json("""{"monto_minor":$n,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18","nota":"ñandú 😀"}"""), 1))
            }
        }
        hora += 1000
        for (c in listOf(a, b, a, b)) assertEquals(FinDelCiclo.AlDia, c.ciclo.correr())
        assertEquals(almacen.instantanea(), a.cola.instantanea())
        assertEquals(almacen.instantanea(), b.cola.instantanea())
        // un token que el servidor no conoce: el celular queda revocado
        val intruso = Celular("t-x", "018f3a6e-0000-7000-8000-00000000000c")
        assertEquals(FinDelCiclo.Revocado, intruso.ciclo.correr())
    }
}
