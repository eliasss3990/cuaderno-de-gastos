package com.eliasgonzalez.cuadernodegastos.red

import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class CanalEnVivoTest {
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"
    private var estado = 200
    private var guion: (java.io.OutputStream) -> Unit = {}
    private var auth = ""
    private val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/v1/trips/$viaje/events") { x ->
            auth = x.requestHeaders.getFirst("Authorization").orEmpty()
            if (estado != 200) {
                x.sendResponseHeaders(estado, -1)
                x.close()
                return@createContext
            }
            x.responseHeaders.add("Content-Type", "text/event-stream")
            x.sendResponseHeaders(200, 0)
            try {
                x.responseBody.use { guion(it) }
            } catch (_: java.io.IOException) {
            }
            x.close()
        }
        executor = java.util.concurrent.Executors.newCachedThreadPool()
        start()
    }

    @After
    fun cerrar() = http.stop(0)

    private fun canal(silencio: Int = 60_000) = CanalEnVivo("http://127.0.0.1:${http.address.port}", viaje, { "t" }, "1.0.0", silencio)

    private fun escribir(o: java.io.OutputStream, s: String) {
        o.write(s.toByteArray())
        o.flush()
    }

    @Test
    fun avisaCadaCabezaEIgnoraLatidosYOtrosEventos() {
        guion = { o ->
            escribir(o, "retry: 5000\n\nid: 3\nevent: novedades\ndata: {\"head_seq\":3}\n\n")
            escribir(o, ":\n\n")
            escribir(o, "event: otro\ndata: {\"head_seq\":99}\n\n")
            escribir(o, "id: 7\nevent: novedades\ndata: {\"head_seq\":7}\n\n")
            escribir(o, "event: novedades\ndata: no es json\n\n")
        }
        val vistas = mutableListOf<Long>()
        assertEquals(FinDelCanal.CORTADO, canal().escuchar { vistas += it })
        assertEquals(listOf(3L, 7L), vistas)
        assertEquals("Bearer t", auth)
    }

    @Test
    fun losErroresDeLaConexionDicenQueHacer() {
        for ((e, f) in listOf(401 to FinDelCanal.REVOCADO, 426 to FinDelCanal.APP_DESACTUALIZADA, 503 to FinDelCanal.NO_DISPONIBLE, 500 to FinDelCanal.NO_DISPONIBLE)) {
            estado = e
            assertEquals("$e", f, canal().escuchar { })
        }
    }

    @Test
    fun sinNadaPorMasDelSilencioMaximoSeDaPorCortado() {
        val seguir = CountDownLatch(1)
        guion = { o ->
            escribir(o, "event: novedades\ndata: {\"head_seq\":1}\n\n")
            seguir.await(5, TimeUnit.SECONDS)
        }
        val t0 = System.currentTimeMillis()
        assertEquals(FinDelCanal.CORTADO, canal(silencio = 300).escuchar { })
        assertTrue(System.currentTimeMillis() - t0 < 4_000)
        seguir.countDown()
    }

    @Test
    fun detenerCortaLaEscucha() {
        val seguir = CountDownLatch(1)
        guion = { o ->
            escribir(o, "event: novedades\ndata: {\"head_seq\":1}\n\n")
            seguir.await(5, TimeUnit.SECONDS)
        }
        val c = canal()
        val oyendo = CountDownLatch(1)
        var fin: FinDelCanal? = null
        val hilo = Thread { fin = c.escuchar { oyendo.countDown() } }
        hilo.start()
        assertTrue(oyendo.await(3, TimeUnit.SECONDS))
        c.detener()
        hilo.join(3_000)
        assertEquals(FinDelCanal.DETENIDO, fin)
        seguir.countDown()
    }

    @Test
    fun unDetenerQueLlegaAntesDeEscucharNoSePierde() {
        guion = { Thread.sleep(3_000) } // si se conectara, quedaría esperando
        val c = canal()
        c.detener()
        val t0 = System.currentTimeMillis()
        assertEquals(FinDelCanal.DETENIDO, c.escuchar { })
        assertTrue(System.currentTimeMillis() - t0 < 1_000)
        assertEquals("", auth) // ni siquiera pidió
    }

    @Test
    fun elLectorJuntaVariasLineasDeDatos() {
        val eventos = mutableListOf<Pair<String, String>>()
        val l = LectorSse { t, d -> eventos += t to d }
        for (x in listOf("data: a", "data:b", "", ": latido", "", "event: novedades", "data: {}", "", "data: sin tipo", "")) l.linea(x)
        // el tipo es de cada evento: el que viene sin `event` no hereda el anterior
        assertEquals(listOf("message" to "a\nb", "novedades" to "{}", "message" to "sin tipo"), eventos)
    }

    @Test
    fun sinServidorEsCortado() {
        http.stop(0)
        assertEquals(FinDelCanal.CORTADO, canal().escuchar { })
    }
}
