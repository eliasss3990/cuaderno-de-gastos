package com.eliasgonzalez.cuadernodegastos.red

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Falla
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.RespuestaDeBajada
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.RespuestaDeOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.RespuestaDeSubida
import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress

/** El cliente contra un servidor HTTP de prueba: cabeceras, cuerpo, respuestas y errores. */
class ClienteHttpTest {
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"
    private val secreto = "token-de-prueba-que-no-debe-aparecer"
    private var estado = 200
    private var respuesta = ""
    private var retryAfter: String? = null
    private val pedidos = mutableListOf<Map<String, String>>()
    private val servidor = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { x ->
            pedidos += mapOf(
                "metodo" to x.requestMethod,
                "ruta" to x.requestURI.toString(),
                "auth" to x.requestHeaders.getFirst("Authorization").orEmpty(),
                "version" to x.requestHeaders.getFirst("X-App-Version").orEmpty(),
                "seq" to x.requestHeaders.getFirst("X-Ultimo-Seq").orEmpty(),
                "pendientes" to x.requestHeaders.getFirst("X-Pendientes").orEmpty(),
                "tipo" to x.requestHeaders.getFirst("Content-Type").orEmpty(),
                "cuerpo" to x.requestBody.readBytes().toString(Charsets.UTF_8),
            )
            retryAfter?.let { x.responseHeaders.add("Retry-After", it) }
            val b = respuesta.toByteArray()
            x.sendResponseHeaders(estado, if (b.isEmpty()) -1 else b.size.toLong())
            if (b.isNotEmpty()) x.responseBody.use { it.write(b) }
            x.close()
        }
        start()
    }
    private val cliente = ClienteHttp("http://127.0.0.1:${servidor.address.port}/", viaje, { secreto }, "1.2.3", { EstadoDelCelular(41, 3) })

    @After
    fun cerrar() = servidor.stop(0)

    private val op = OpGuardada("o1", "expense.update", "expense", "e1", "h1", JsonObject(mapOf("concepto" to JsonPrimitive("ñ 😀"))), false, null, 1)

    @Test
    fun subirMandaElLoteConSusCabecerasYLeeLosResultados() {
        respuesta = """{"resultados":[{"op_id":"o1","estado":"accepted","server_seq":7,"hlc":"h2"},{"op_id":"o2","estado":"duplicate","server_seq":3,"hlc":"h3"},{"op_id":"o3","estado":"rejected","razon":"viaje_cerrado","hlc":"h4"}]}"""
        val r = cliente.subir(listOf(op)) as RespuestaDeSubida.Ok
        assertEquals(
            listOf(RespuestaDeOp("o1", true, 7, "h2", null), RespuestaDeOp("o2", true, 3, "h3", null), RespuestaDeOp("o3", false, null, "h4", "viaje_cerrado")),
            r.resultados,
        )
        val p = pedidos.single()
        assertEquals(listOf("POST", "/v1/trips/$viaje/ops", "Bearer $secreto", "1.2.3", "41", "3"), listOf(p["metodo"], p["ruta"], p["auth"], p["version"], p["seq"], p["pendientes"]))
        assertTrue(p["tipo"]!!.startsWith("application/json"))
        val cuerpo = Json.parseToJsonElement(p["cuerpo"]!!).jsonObject
        assertEquals(Json.parseToJsonElement("""{"ops":[{"op_id":"o1","type":"expense.update","entity_type":"expense","entity_id":"e1","hlc":"h1","payload":{"concepto":"ñ 😀"},"schema_version":1}]}"""), cuerpo)
    }

    @Test
    fun bajarLeeLaPaginaConRedactadasPadreYHora() {
        respuesta = """{"ops":[{"server_seq":5,"op_id":"o5","type":"expense.create","entity_type":"expense","entity_id":"e5","hlc":"h5","payload":{"monto_minor":1},"redacted":false,"schema_version":1,"device_id":"d","member_id":"m","padre_id":null},{"server_seq":6,"op_id":"o6","type":"attachment.add","entity_type":"attachment","entity_id":"a6","hlc":"h6","payload":null,"redacted":true,"schema_version":1,"device_id":"d","member_id":"m","padre_id":"e5"}],"next":6,"hay_mas":true,"head_seq":9,"ahora":1802000000000}"""
        val p = (cliente.bajar(4, 200) as RespuestaDeBajada.Ok).pagina
        assertEquals(listOf(5L, 6L), p.ops.map { it.serverSeq })
        assertNull(p.ops[1].payload)
        assertEquals("e5", p.ops[1].padreId)
        assertNull(p.ops[0].padreId)
        assertEquals(true to 1802000000000L, p.hayMas to p.horaDelServidor)
        assertEquals("/v1/trips/$viaje/changes?after=4&limit=200", pedidos.single()["ruta"])
    }

    @Test
    fun cadaErrorHttpSeTraduceALoQueHaceElCiclo() {
        val casos = listOf(
            401 to Falla.REVOCADO, 413 to Falla.DEMASIADO_GRANDE, 426 to Falla.APP_DESACTUALIZADA,
            408 to Falla.TRANSITORIA, 429 to Falla.TRANSITORIA, 500 to Falla.TRANSITORIA, 503 to Falla.TRANSITORIA, 599 to Falla.TRANSITORIA,
            400 to Falla.PEDIDO_RECHAZADO, 403 to Falla.PEDIDO_RECHAZADO, 404 to Falla.PEDIDO_RECHAZADO, 415 to Falla.PEDIDO_RECHAZADO,
        )
        for ((e, f) in casos) {
            estado = e
            respuesta = """{"error":{"codigo":"x","mensaje":"y"}}"""
            assertEquals("$e", f, (cliente.subir(listOf(op)) as RespuestaDeSubida.Error).falla)
            assertEquals("$e", f, (cliente.bajar(0, 10) as RespuestaDeBajada.Error).falla)
        }
    }

    @Test
    fun respetaElRetryAfterEnSegundos() {
        estado = 503
        retryAfter = "12"
        assertEquals(12_000L, (cliente.subir(listOf(op)) as RespuestaDeSubida.Error).reintentarEnMs)
        retryAfter = "mañana"
        assertNull((cliente.bajar(0, 1) as RespuestaDeBajada.Error).reintentarEnMs)
    }

    @Test
    fun unaRespuestaRotaOSinServidorEsUnaFallaTransitoria() {
        respuesta = "{no es json"
        assertEquals(Falla.TRANSITORIA, (cliente.subir(listOf(op)) as RespuestaDeSubida.Error).falla)
        assertEquals(Falla.TRANSITORIA, (cliente.bajar(0, 1) as RespuestaDeBajada.Error).falla)
        servidor.stop(0)
        assertEquals(Falla.TRANSITORIA, (cliente.subir(listOf(op)) as RespuestaDeSubida.Error).falla)
        assertEquals(Falla.TRANSITORIA, (cliente.bajar(0, 1) as RespuestaDeBajada.Error).falla)
    }

    @Test
    fun unaOpRedactadaSeMandaConPayloadVacio() {
        respuesta = """{"resultados":[]}"""
        cliente.subir(listOf(op.copy(payload = null, redactada = true)))
        assertTrue(pedidos.single()["cuerpo"]!!.contains("\"payload\":{}"))
    }
}
