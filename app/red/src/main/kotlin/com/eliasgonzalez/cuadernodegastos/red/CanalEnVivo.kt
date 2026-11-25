// El canal en vivo (GET /v1/trips/{viaje}/events, SSE): el servidor solo avisa "hay novedades hasta la secuencia N" y el
// celular baja con la sincronización de siempre, así que el canal nunca es la fuente de verdad. Esta clase lee el flujo y
// avisa cada cabeza nueva; reconectar (con espera creciente y una sincronización al volver) lo decide quien la usa. Cada
// instancia sirve para una sola escucha: un `detener` que llega antes o durante la conexión no se pierde.
package com.eliasgonzalez.cuadernodegastos.red

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI

/** Cómo terminó una escucha. */
enum class FinDelCanal {
    /** El servidor cerró o se cortó la conexión: reconectar con espera. */
    CORTADO,

    /** 401: el dispositivo fue revocado. */
    REVOCADO,

    /** 426: hay que actualizar la app. */
    APP_DESACTUALIZADA,

    /** 503 (canal lleno) u otro error: reconectar más tarde o caer a la consulta periódica. */
    NO_DISPONIBLE,

    /** Quien escuchaba pidió cortar. */
    DETENIDO,
}

/** Lee un flujo SSE línea por línea y junta cada evento (tipo y datos). */
class LectorSse(private val alEvento: (tipo: String, datos: String) -> Unit) {
    private var tipo = ""
    private val datos = StringBuilder()

    fun linea(l: String) {
        when {
            l.isEmpty() -> {
                // fin del evento: un latido (solo comentarios) no deja nada
                if (datos.isNotEmpty() || tipo.isNotEmpty()) alEvento(tipo.ifEmpty { "message" }, datos.toString())
                tipo = ""
                datos.setLength(0)
            }
            l.startsWith(":") -> Unit // comentario (latido)
            else -> {
                val campo = l.substringBefore(':')
                val valor = l.substringAfter(':', "").removePrefix(" ")
                when (campo) {
                    "event" -> tipo = valor
                    "data" -> {
                        if (datos.isNotEmpty()) datos.append('\n')
                        datos.append(valor)
                    }
                    else -> Unit // id y retry: el celular reconecta con su propia espera y baja desde su última secuencia
                }
            }
        }
    }
}

class CanalEnVivo(
    private val base: String,
    private val viaje: String,
    private val token: () -> String,
    private val versionDeLaApp: String,
    /** Sin nada por más de este tiempo (el servidor manda un latido cada 20 s) se da por cortado. */
    private val silencioMaximoMs: Int = 60_000,
) {
    @Volatile
    private var conexion: HttpURLConnection? = null

    @Volatile
    private var detenido = false

    /**
     * Escucha hasta que el canal termine. Bloquea: corre en su propio hilo. `alNovedad` recibe cada cabeza anunciada; si
     * lanza, la excepción sale de acá (la conexión se cierra igual).
     */
    fun escuchar(alNovedad: (cabeza: Long) -> Unit): FinDelCanal {
        if (detenido) return FinDelCanal.DETENIDO
        val c = try {
            URI.create(base.trimEnd('/') + "/v1/trips/$viaje/events").toURL().openConnection() as HttpURLConnection
        } catch (_: IOException) {
            return FinDelCanal.CORTADO
        }
        conexion = c
        try {
            // detener pudo llegar entre el chequeo de arriba y guardar la conexión
            if (detenido) return FinDelCanal.DETENIDO
            c.connectTimeout = 30_000
            c.readTimeout = silencioMaximoMs
            c.setRequestProperty("Authorization", "Bearer ${token()}")
            c.setRequestProperty("X-App-Version", versionDeLaApp)
            c.setRequestProperty("Accept", "text/event-stream")
            // sin compresión: un intermediario que comprime podría juntar varios avisos antes de entregarlos
            c.setRequestProperty("Accept-Encoding", "identity")
            when (c.responseCode) {
                200 -> Unit
                401 -> return FinDelCanal.REVOCADO
                426 -> return FinDelCanal.APP_DESACTUALIZADA
                else -> return FinDelCanal.NO_DISPONIBLE
            }
            val lector = LectorSse { tipo, datos ->
                if (tipo != "novedades") return@LectorSse
                val cabeza = try {
                    (Json.parseToJsonElement(datos).jsonObject["head_seq"] as? JsonPrimitive)?.longOrNull
                } catch (_: RuntimeException) {
                    null
                }
                if (cabeza != null) alNovedad(cabeza)
            }
            BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { r ->
                var l = r.readLine()
                while (l != null) {
                    lector.linea(l)
                    l = r.readLine()
                }
            }
            return if (detenido) FinDelCanal.DETENIDO else FinDelCanal.CORTADO
        } catch (_: IOException) {
            return if (detenido) FinDelCanal.DETENIDO else FinDelCanal.CORTADO
        } finally {
            conexion = null
            c.disconnect()
        }
    }

    /** Corta la escucha en curso (la app pasó a segundo plano). */
    fun detener() {
        detenido = true
        conexion?.disconnect()
    }
}
