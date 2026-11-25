package com.eliasgonzalez.cuadernodegastos.sincronizacion

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import com.eliasgonzalez.cuadernodegastos.base.BaseAndroid
import com.eliasgonzalez.cuadernodegastos.datos.Migraciones
import com.eliasgonzalez.cuadernodegastos.datos.AlmacenSqlite
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.TiemposDelCoordinador
import com.eliasgonzalez.cuadernodegastos.red.Credenciales
import com.eliasgonzalez.cuadernodegastos.sesion.Cifrador
import com.eliasgonzalez.cuadernodegastos.sesion.Tokens
import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import java.net.InetSocketAddress
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

private class SinCifrar : Cifrador {
    override fun cifrar(claro: ByteArray) = claro

    override fun descifrar(cifrado: ByteArray) = cifrado
}

/** Un servidor mínimo: acepta todo lo que se sube, no tiene nada para bajar y el canal avisa la cabeza 0. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SincronizacionTest {
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"
    private val dispositivo = "018f3a6e-0000-7000-8000-00000000000a"
    private val pedidos = LinkedBlockingQueue<String>()

    @Volatile
    private var canalLleno = false
    private val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/v1/trips/$viaje/") { x ->
            pedidos += x.requestMethod + " " + x.requestURI.path.substringAfterLast('/') + " " + x.requestHeaders.getFirst("Authorization")
            val cuerpo = when {
                x.requestURI.path.endsWith("/events") && canalLleno -> {
                    x.sendResponseHeaders(503, -1)
                    x.close()
                    return@createContext
                }
                x.requestURI.path.endsWith("/events") -> {
                    x.responseHeaders.add("Content-Type", "text/event-stream")
                    x.sendResponseHeaders(200, 0)
                    x.responseBody.write("event: novedades\ndata: {\"head_seq\":0}\n\n".toByteArray())
                    x.responseBody.flush()
                    // el canal queda abierto: lo único que dispara ciclos es lo que hace la prueba
                    Thread.sleep(3_000)
                    x.close()
                    return@createContext
                }
                x.requestMethod == "POST" -> {
                    val ops = Json.parseToJsonElement(x.requestBody.readBytes().toString(Charsets.UTF_8)).jsonObject["ops"]!!.jsonArray
                    val res = ops.mapIndexed { i, o ->
                        val op = o.jsonObject
                        """{"op_id":"${op["op_id"]!!.jsonPrimitive.content}","estado":"accepted","server_seq":${i + 1},"hlc":"${op["hlc"]!!.jsonPrimitive.content}"}"""
                    }
                    """{"resultados":[${res.joinToString(",")}]}"""
                }
                else -> """{"ops":[],"hay_mas":false,"ahora":${System.currentTimeMillis()}}"""
            }.toByteArray()
            x.sendResponseHeaders(200, cuerpo.size.toLong())
            x.responseBody.use { it.write(cuerpo) }
            x.close()
        }
        executor = java.util.concurrent.Executors.newCachedThreadPool()
        start()
    }
    private val prefs = ApplicationProvider.getApplicationContext<Context>().getSharedPreferences(Tokens.ARCHIVO, Context.MODE_PRIVATE)
    @Volatile
    private var romperLaCola = false
    private val real = BaseAndroid(SQLiteDatabase.create(null)).also { Migraciones.aplicar(it) }

    /** La base de verdad, que puede fallar al leer la cola (para ver que un viaje roto no frena a los demás). */
    private val base = object : com.eliasgonzalez.cuadernodegastos.datos.BaseSql by real {
        override fun consultar(sql: String, vararg args: Any?): List<com.eliasgonzalez.cuadernodegastos.datos.Fila> {
            if (romperLaCola && "FROM op" in sql) throw IllegalStateException("la base falló")
            return real.consultar(sql, *args)
        }
    }
    private val estados = LinkedBlockingQueue<Pair<String, EstadoDeSincronizacion>>()
    private val s = Sincronizacion(base, Tokens(prefs, SinCifrar()), "http://127.0.0.1:${http.address.port}", "1.0.0", { v, e -> estados += v to e })

    @After
    fun cerrar() {
        s.close()
        http.stop(0)
    }

    private fun vinculado() = s.vincular(Credenciales(viaje, dispositivo, "m", "tok"))

    private val vistos = mutableListOf<String>()

    /** Espera un pedido que cumpla la condición, llegado antes o después (los pedidos pueden llegar en cualquier orden). */
    private fun esperarPedido(cond: (String) -> Boolean): String {
        val hasta = System.currentTimeMillis() + 5_000
        while (true) {
            vistos.firstOrNull(cond)?.let { return it }
            if (System.currentTimeMillis() > hasta) error("no llegó el pedido; llegaron $vistos")
            pedidos.poll(100, TimeUnit.MILLISECONDS)?.let { vistos += it }
        }
    }

    @Test
    fun vincularGuardaElViajeYElTokenUnaSolaVez() {
        vinculado()
        assertEquals(listOf(viaje), s.viajes())
        assertThrows(IllegalStateException::class.java) { vinculado() }
    }

    @Test
    fun laTareaPeriodicaCorreUnCicloPorViajeConSuToken() {
        vinculado()
        assertEquals(mapOf(viaje to FinDelCiclo.AlDia), s.cicloDeTodos())
        assertEquals("GET changes Bearer tok", esperarPedido { it.startsWith("GET changes") })
    }

    @Test
    fun registrarGuardaLaOperacionYLaSubeSinEsperar() {
        vinculado()
        val r = s.registrar(viaje) { sinc ->
            Operacion("018f3a6e-9000-7000-8000-000000000002", "trip.create", "trip", viaje, sinc.nuevaMarca(), Json.parseToJsonElement("""{"nombre":"V","zona_horaria":"America/Asuncion","monedas":[{"codigo":"PYG","decimales":0,"simbolo":"₲"}]}""").jsonObject, 1)
        }
        assertTrue("$r", r is Resultado.Aceptada)
        assertEquals("POST ops Bearer tok", esperarPedido { it.startsWith("POST") })
        // y queda confirmada (el servidor de prueba la acepta)
        val hasta = System.currentTimeMillis() + 5_000
        while ("confirmada=1" !in s.resumen(viaje) && System.currentTimeMillis() < hasta) Thread.sleep(50)
        assertTrue(s.resumen(viaje), "pendiente=0 enviando=0 confirmada=1" in s.resumen(viaje))
    }

    @Test
    fun losTiemposDelCoordinadorSonLosQueSeLePasan() {
        // con el canal lleno, la consulta de respaldo corre cada 300 ms (no cada minuto)
        canalLleno = true
        val corto = Sincronizacion(base, Tokens(prefs, SinCifrar()), "http://127.0.0.1:${http.address.port}", "1.0.0", tiempos = TiemposDelCoordinador(30_000, 300))
        try {
            corto.vincular(Credenciales(viaje, dispositivo, "m", "tok"))
            corto.alPrimerPlano()
            // a 300 ms entre consultas, 3 ciclos llegan mucho antes de los 10 s (con el minuto real, no)
            var ciclos = 0
            val hasta = System.currentTimeMillis() + 10_000
            while (ciclos < 3 && System.currentTimeMillis() < hasta) {
                if (pedidos.poll(100, TimeUnit.MILLISECONDS)?.startsWith("GET changes") == true) ciclos++
            }
            assertTrue("ciclos: $ciclos", ciclos >= 3)
        } finally {
            corto.close()
        }
    }

    @Test
    fun registrarSinTokenFallaYNoGuardaNada() {
        vinculado()
        prefs.edit().clear().commit()
        assertThrows(IllegalStateException::class.java) {
            s.registrar(viaje) { error("no debía armar la operación") }
        }
        assertTrue(s.resumen(viaje), "pendiente=0" in s.resumen(viaje))
    }

    @Test
    fun lasCredencialesSonLasGuardadasYSinTokenNoHay() {
        assertEquals(null, s.credenciales(viaje))
        vinculado()
        assertEquals(Credenciales(viaje, dispositivo, "m", "tok"), s.credenciales(viaje))
        prefs.edit().clear().commit()
        assertEquals(null, s.credenciales(viaje))
    }

    @Test
    fun elResumenNoMuestraElToken() {
        vinculado()
        val r = s.resumen(viaje)
        assertTrue(r, r.startsWith("viaje=$viaje seq=0 revocado=false gastos=0 pendiente=0"))
        assertTrue("tok" !in r.substringAfter("seq="))
    }

    @Test
    fun unaFallaDeLaBaseEnLaTareaPeriodicaTerminaEnErrorSinLanzar() {
        vinculado()
        romperLaCola = true
        assertEquals(mapOf(viaje to FinDelCiclo.Error), s.cicloDeTodos())
    }

    @Test
    fun unViajeSinTokenLegibleNoSincronizaYPideVolverAVincular() {
        vinculado()
        prefs.edit().clear().commit()
        assertEquals(mapOf(viaje to FinDelCiclo.Revocado), s.cicloDeTodos())
        assertEquals(viaje to EstadoDeSincronizacion.Revocado, estados.poll(2, TimeUnit.SECONDS))
        assertTrue(pedidos.isEmpty())
    }

    @Test
    fun enPantallaAbreElCanalYSincronizaYUnCambioLocalSeSube() {
        vinculado()
        s.alPrimerPlano()
        esperarPedido { it.startsWith("GET events Bearer tok") }
        esperarPedido { it.startsWith("GET changes") }
        // el primer ciclo terminó (si no, subiría lo que se registra ahora sin que haga falta el aviso)
        var e = estados.poll(5, TimeUnit.SECONDS)
        while (e != viaje to EstadoDeSincronizacion.AlDia) e = estados.poll(5, TimeUnit.SECONDS) ?: error("no quedó al día")
        // una operación nueva: se registra y se avisa
        val almacen = AlmacenSqlite(base, viaje)
        val sinc = Sincronizador(almacen) { System.currentTimeMillis() }
        val r = sinc.registrar(Operacion("018f3a6e-9000-7000-8000-000000000001", "trip.create", "trip", viaje, sinc.nuevaMarca(), Json.parseToJsonElement("""{"nombre":"V","zona_horaria":"America/Asuncion","monedas":[{"codigo":"PYG","decimales":0,"simbolo":"₲"}]}""").jsonObject, 1))
        assertTrue("aceptada al registrar: $r", r is Resultado.Aceptada)
        s.alCambioLocal(viaje)
        assertEquals("POST ops Bearer tok", esperarPedido { it.startsWith("POST") })
    }
}
