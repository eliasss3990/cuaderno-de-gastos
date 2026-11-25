package com.eliasgonzalez.cuadernodegastos.red

import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress

class ClienteDeIdentidadTest {
    private var estado = 201
    private var respuesta = """{"trip_id":"v","device_id":"d","member_id":"m","token":"secreto"}"""
    private var cabeceras = mapOf<String, String>()
    private var ruta = ""
    private var cuerpo: JsonObject? = null
    private var auth: String? = null
    private val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { x ->
            ruta = x.requestMethod + " " + x.requestURI.path
            auth = x.requestHeaders.getFirst("Authorization")
            cuerpo = Json.parseToJsonElement(x.requestBody.readBytes().toString(Charsets.UTF_8)).jsonObject
            cabeceras.forEach { (k, v) -> x.responseHeaders.add(k, v) }
            val b = respuesta.toByteArray()
            x.sendResponseHeaders(estado, if (b.isEmpty()) -1 else b.size.toLong())
            if (b.isNotEmpty()) x.responseBody.use { it.write(b) }
            x.close()
        }
        start()
    }

    @After
    fun cerrar() = http.stop(0)

    private val cliente get() = ClienteDeIdentidad("http://127.0.0.1:${http.address.port}/", "1.2.3")
    private val yo = Perfil("Pixel", "Eli", "#E8E4F3", "🙂")

    @Test
    fun crearUnViajeMandaLoQueEsperaElServidorYDevuelveLasCredenciales() {
        val r = cliente.crearViaje(ViajeNuevo("Brasil", "America/Sao_Paulo", listOf(MonedaNueva("BRL", 2, "R$")), "2027-02-01"), yo)
        assertEquals(Resultado.Ok(Credenciales("v", "d", "m", "secreto")), r)
        assertEquals("POST /v1/trips", ruta)
        assertEquals(null, auth)
        assertEquals(
            Json.parseToJsonElement(
                """{"nombre":"Brasil","zona_horaria":"America/Sao_Paulo","fecha_inicio":"2027-02-01","fecha_fin":null,
                "monedas":[{"codigo":"BRL","decimales":2,"simbolo":"R$"}],"nombre_dispositivo":"Pixel","apodo":"Eli","color":"#E8E4F3","emoji":"🙂"}""",
            ),
            cuerpo,
        )
    }

    @Test
    fun unirseYReemplazarMandanSoloLoQueCorresponde() {
        cliente.unirse("ABC-123", yo)
        assertEquals("POST /v1/join", ruta)
        assertEquals(setOf("codigo", "nombre_dispositivo", "apodo", "color", "emoji"), cuerpo!!.keys)
        cliente.reemplazar("ABC-123", "Moto")
        assertEquals(Json.parseToJsonElement("""{"codigo":"ABC-123","nombre_dispositivo":"Moto"}"""), cuerpo)
    }

    @Test
    fun invitarVaConElTokenDelViaje() {
        respuesta = """{"codigo":"K7P-2QX","vence_en":1700000000000}"""
        val r = cliente.invitar(Credenciales("v1", "d", "m", "tok"), reemplazaA = "m2")
        assertEquals(Resultado.Ok(Invitacion("K7P-2QX", 1_700_000_000_000)), r)
        assertEquals("POST /v1/trips/v1/invitations", ruta)
        assertEquals("Bearer tok", auth)
        assertEquals(Json.parseToJsonElement("""{"reemplaza_member_id":"m2"}"""), cuerpo)
        cliente.invitar(Credenciales("v1", "d", "m", "tok"))
        assertEquals(Json.parseToJsonElement("""{"reemplaza_member_id":null}"""), cuerpo)
    }

    @Test
    fun cadaErrorDelServidorDiceQuePaso() {
        val casos = listOf(
            Triple(400, "codigo_invalido", Rechazo.CODIGO_INVALIDO),
            Triple(409, "viaje_completo", Rechazo.VIAJE_COMPLETO),
            Triple(429, "demasiados_intentos", Rechazo.DEMASIADOS_INTENTOS),
            Triple(409, "demasiadas_invitaciones", Rechazo.DEMASIADAS_INVITACIONES),
            Triple(403, "solo_organizador", Rechazo.SOLO_ORGANIZADOR),
            Triple(401, "dispositivo_revocado", Rechazo.REVOCADO),
            Triple(401, "no_autorizado", Rechazo.REVOCADO),
            Triple(400, "formato_invalido", Rechazo.DATOS_INVALIDOS),
            Triple(404, "no_existe", Rechazo.OTRO),
            // sin cuerpo reconocible, el estado decide
            Triple(429, null, Rechazo.DEMASIADOS_INTENTOS),
            Triple(401, null, Rechazo.REVOCADO),
            Triple(400, null, Rechazo.OTRO),
        )
        for ((e, codigo, motivo) in casos) {
            estado = e
            respuesta = codigo?.let { """{"error":{"codigo":"$it","mensaje":"m $it"}}""" } ?: "no es json"
            assertEquals("$e $codigo", Resultado.Rechazado(motivo, codigo?.let { "m $it" }), cliente.unirse("X", yo))
        }
    }

    @Test
    fun demasiadosIntentosTraeCuantoEsperar() {
        estado = 429
        respuesta = """{"error":{"codigo":"demasiados_intentos","mensaje":"esperá"}}"""
        cabeceras = mapOf("Retry-After" to "900")
        assertEquals(Resultado.Rechazado(Rechazo.DEMASIADOS_INTENTOS, "esperá", 900_000), cliente.unirse("X", yo))
    }

    @Test
    fun loQuePudoLlegarAlServidorEsInciertoSalvoAlInvitar() {
        for (e in listOf(500, 502, 503, 408)) {
            estado = e
            respuesta = ""
            assertEquals("$e", Resultado.Incierto, cliente.unirse("X", yo))
            assertEquals("$e", Resultado.Incierto, cliente.reemplazar("X", "Moto"))
            assertEquals("$e", Resultado.Incierto, cliente.crearViaje(ViajeNuevo("V", "UTC", emptyList()), yo))
            assertEquals("$e", Resultado.SinConexion, cliente.invitar(Credenciales("v", "d", "m", "t")))
        }
        estado = 201
        respuesta = """{"trip_id":"v"}"""
        assertEquals(Resultado.Incierto, cliente.unirse("X", yo))
        estado = 426
        assertEquals(Resultado.AppDesactualizada, cliente.unirse("X", yo))
    }

    @Test
    fun sinPoderConectarNoSeMandoNadaYSePuedeReintentar() {
        http.stop(0)
        assertEquals(Resultado.SinConexion, cliente.unirse("X", yo))
        assertEquals(Resultado.SinConexion, ClienteDeIdentidad("http://no-existe.invalid", "1.0.0").unirse("X", yo))
    }

    @Test
    fun unaRespuestaQueNoLlegaATiempoEsIncierta() {
        val lento = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/") { x ->
                x.requestBody.readBytes()
                Thread.sleep(1_500)
                x.close()
            }
            start()
        }
        try {
            assertEquals(Resultado.Incierto, ClienteDeIdentidad("http://127.0.0.1:${lento.address.port}", "1.0.0", esperaMaximaMs = 300).unirse("X", yo))
        } finally {
            lento.stop(0)
        }
    }

    @Test
    fun elTokenNoApareceAlMostrarLasCredenciales() {
        val c = Credenciales("v", "d", "m", "secreto")
        assertFalse("secreto" in c.toString())
        assertEquals("Credenciales(viaje=v, dispositivo=d, integrante=m)", c.toString())
        assertFalse(c == Credenciales("v", "d", "m", "otro"))
        assertEquals(c.hashCode(), Credenciales("v", "d", "m", "secreto").hashCode())
    }
}
