// El servidor visto por HTTP: subir un lote (POST /v1/trips/{viaje}/ops) y bajar cambios (GET .../changes). Traduce las
// respuestas y los errores a lo que entiende el ciclo de sincronización. Nunca escribe el token en ningún lado.
package com.eliasgonzalez.cuadernodegastos.red

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Falla
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.OpDelServidor
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Pagina
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.RespuestaDeBajada
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.RespuestaDeOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.RespuestaDeSubida
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Servidor
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/** Lo que el celular informa en cada pedido (para la lista de la familia). */
data class EstadoDelCelular(val ultimoSeq: Long, val pendientes: Int)

class ClienteHttp(
    private val base: String,
    private val viaje: String,
    private val token: () -> String,
    private val versionDeLaApp: String,
    private val estado: () -> EstadoDelCelular,
    private val esperaMaximaMs: Int = 30_000,
) : Servidor {
    private class Respuesta(val estado: Int, val cuerpo: String, val reintentarEnMs: Long?)

    private fun pedir(metodo: String, ruta: String, cuerpo: String?): Respuesta {
        val c = URI.create(base.trimEnd('/') + ruta).toURL().openConnection() as HttpURLConnection
        try {
            c.requestMethod = metodo
            c.connectTimeout = esperaMaximaMs
            c.readTimeout = esperaMaximaMs
            c.setRequestProperty("Authorization", "Bearer ${token()}")
            c.setRequestProperty("X-App-Version", versionDeLaApp)
            val e = estado()
            c.setRequestProperty("X-Ultimo-Seq", e.ultimoSeq.toString())
            c.setRequestProperty("X-Pendientes", e.pendientes.toString())
            c.setRequestProperty("Accept", "application/json")
            if (cuerpo != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(cuerpo.toByteArray(Charsets.UTF_8)) }
            }
            val estado = c.responseCode
            val flujo = if (estado >= 400) c.errorStream else c.inputStream
            val texto = flujo?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
            val reintentar = c.getHeaderField("Retry-After")?.trim()?.toLongOrNull()?.takeIf { it >= 0 }?.times(1000)
            return Respuesta(estado, texto, reintentar)
        } finally {
            c.disconnect()
        }
    }

    /** Qué hace el ciclo con cada estado HTTP que no es éxito. */
    private fun falla(estado: Int): Falla = when (estado) {
        401 -> Falla.REVOCADO
        413 -> Falla.DEMASIADO_GRANDE
        426 -> Falla.APP_DESACTUALIZADA
        // sin red del lado del servidor, demasiados pedidos o una falla suya: se reintenta con espera (hasta 15 min)
        408, 429 -> Falla.TRANSITORIA
        in 500..599 -> Falla.TRANSITORIA
        // el pedido no sirve (400, 403, 404, 415…): reintentarlo no lo arregla
        else -> Falla.PEDIDO_RECHAZADO
    }

    private fun alCable(o: OpGuardada) = JsonObject(
        mapOf(
            "op_id" to JsonPrimitive(o.opId),
            "type" to JsonPrimitive(o.tipo),
            "entity_type" to JsonPrimitive(o.entidadTipo),
            "entity_id" to JsonPrimitive(o.entidadId),
            "hlc" to JsonPrimitive(o.hlc),
            "payload" to (o.payload ?: JsonObject(emptyMap())),
            "schema_version" to JsonPrimitive(o.schemaVersion),
        ),
    )

    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    override fun subir(ops: List<OpGuardada>): RespuestaDeSubida {
        val r = try {
            pedir("POST", "/v1/trips/$viaje/ops", JsonObject(mapOf("ops" to JsonArray(ops.map { alCable(it) }))).toString())
        } catch (_: IOException) {
            return RespuestaDeSubida.Error(Falla.SIN_RED)
        }
        if (r.estado != 200) return RespuestaDeSubida.Error(falla(r.estado), r.reintentarEnMs)
        val resultados = try {
            Json.parseToJsonElement(r.cuerpo).jsonObject["resultados"]!!.jsonArray.map { it.jsonObject }.map { o ->
                val estado = texto(o["estado"])
                RespuestaDeOp(
                    opId = texto(o["op_id"])!!,
                    aceptada = estado == "accepted" || estado == "duplicate",
                    serverSeq = (o["server_seq"] as? JsonPrimitive)?.longOrNull,
                    hlc = texto(o["hlc"])!!,
                    razon = texto(o["razon"]),
                )
            }
        } catch (_: RuntimeException) {
            return RespuestaDeSubida.Error(Falla.TRANSITORIA) // una respuesta rota: el lote se vuelve a mandar
        }
        return RespuestaDeSubida.Ok(resultados, null)
    }

    override fun bajar(despuesDe: Long, limite: Int): RespuestaDeBajada {
        val r = try {
            pedir("GET", "/v1/trips/$viaje/changes?after=$despuesDe&limit=$limite", null)
        } catch (_: IOException) {
            return RespuestaDeBajada.Error(Falla.SIN_RED)
        }
        if (r.estado != 200) return RespuestaDeBajada.Error(falla(r.estado), r.reintentarEnMs)
        return try {
            val o = Json.parseToJsonElement(r.cuerpo).jsonObject
            val ops = o["ops"]!!.jsonArray.map { it.jsonObject }.map { x ->
                OpDelServidor(
                    opId = texto(x["op_id"])!!,
                    tipo = texto(x["type"])!!,
                    entidadTipo = texto(x["entity_type"])!!,
                    entidadId = texto(x["entity_id"])!!,
                    hlc = texto(x["hlc"])!!,
                    payload = (x["payload"] as? JsonObject),
                    schemaVersion = (x["schema_version"] as JsonPrimitive).intOrNull!!,
                    serverSeq = (x["server_seq"] as JsonPrimitive).longOrNull!!,
                    padreId = texto(x["padre_id"]),
                    autor = texto(x["member_id"]),
                )
            }
            val hayMas = (o["hay_mas"] as? JsonPrimitive)?.booleanOrNull ?: false
            RespuestaDeBajada.Ok(Pagina(ops, hayMas, (o["ahora"] as? JsonPrimitive)?.longOrNull))
        } catch (_: RuntimeException) {
            RespuestaDeBajada.Error(Falla.TRANSITORIA)
        }
    }
}
