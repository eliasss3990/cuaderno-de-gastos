// Crear un viaje, unirse con un código e invitar: lo único que exige conexión. Devuelve las credenciales del celular
// (el token se guarda aparte, cifrado) o por qué no se pudo. El token nunca se escribe en mensajes ni registros.
package com.eliasgonzalez.cuadernodegastos.red

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.URI
import java.net.UnknownHostException

/** Lo que el celular necesita para sincronizar un viaje. */
class Credenciales(val viaje: String, val dispositivo: String, val integrante: String, val token: String) {
    override fun toString() = "Credenciales(viaje=$viaje, dispositivo=$dispositivo, integrante=$integrante)"

    override fun equals(other: Any?) = other is Credenciales && other.viaje == viaje && other.dispositivo == dispositivo &&
        other.integrante == integrante && other.token == token

    override fun hashCode() = listOf(viaje, dispositivo, integrante, token).hashCode()
}

data class MonedaNueva(val codigo: String, val decimales: Int, val simbolo: String)

/** Cómo se presenta el celular ante la familia. */
data class Perfil(val nombreDelDispositivo: String, val apodo: String, val color: String, val emoji: String)

data class ViajeNuevo(
    val nombre: String,
    val zonaHoraria: String,
    val monedas: List<MonedaNueva>,
    val fechaInicio: String? = null,
    val fechaFin: String? = null,
)

enum class Rechazo {
    /** El código no existe, ya se usó o venció. */
    CODIGO_INVALIDO,

    /** Ya hay 4 celulares activos en el viaje. */
    VIAJE_COMPLETO,

    /** Demasiados intentos fallidos desde esta red: esperar. */
    DEMASIADOS_INTENTOS,

    /** Ya hay demasiadas invitaciones sin usar. */
    DEMASIADAS_INVITACIONES,

    /** Solo quien organiza el viaje puede hacerlo. */
    SOLO_ORGANIZADOR,

    /** El celular fue revocado o su token no sirve. */
    REVOCADO,

    /** Algún dato no es válido (el mensaje del servidor dice cuál). */
    DATOS_INVALIDOS,

    /** Cualquier otro error del servidor. */
    OTRO,
}

sealed interface Resultado<out T> {
    data class Ok<T>(val valor: T) : Resultado<T>

    data class Rechazado(val motivo: Rechazo, val mensaje: String?, val reintentarEnMs: Long? = null) : Resultado<Nothing>

    /** El pedido no llegó al servidor (sin red) o no hace nada si se repite: se puede volver a probar. */
    data object SinConexion : Resultado<Nothing>

    /**
     * Crear o unirse pudo haber quedado hecho sin que llegara la respuesta (tiempo agotado, falla del servidor o del
     * camino). Repetirlo no es seguro: crearía otro viaje, o el código ya usado daría "código inválido". La app no
     * reintenta sola y le dice a la persona qué pasó (unirse: pedir un código nuevo; el celular fantasma se revoca desde
     * la familia).
     */
    data object Incierto : Resultado<Nothing>

    data object AppDesactualizada : Resultado<Nothing>
}

data class Invitacion(val codigo: String, val venceEn: Long)

class ClienteDeIdentidad(
    private val base: String,
    private val versionDeLaApp: String,
    private val esperaMaximaMs: Int = 30_000,
) {
    private class Respuesta(val estado: Int, val cuerpo: JsonObject?, val reintentarEnMs: Long?)

    private fun pedir(ruta: String, cuerpo: JsonObject, token: String? = null): Respuesta {
        val c = URI.create(base.trimEnd('/') + ruta).toURL().openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = esperaMaximaMs
            c.readTimeout = esperaMaximaMs
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("X-App-Version", versionDeLaApp)
            c.setRequestProperty("Accept", "application/json")
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(cuerpo.toString().toByteArray(Charsets.UTF_8)) }
            val estado = c.responseCode
            val texto = (if (estado >= 400) c.errorStream else c.inputStream)?.use { it.readBytes().toString(Charsets.UTF_8) }
            val json = try {
                texto?.let { Json.parseToJsonElement(it) as? JsonObject }
            } catch (_: RuntimeException) {
                null
            }
            val reintentar = c.getHeaderField("Retry-After")?.trim()?.toLongOrNull()?.takeIf { it >= 0 }?.times(1000)
            return Respuesta(estado, json, reintentar)
        } finally {
            c.disconnect()
        }
    }

    private fun texto(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** `repetible`: repetir el pedido no hace daño (invitar); si no, lo que pudo llegar al servidor es incierto. */
    private fun <T> resultado(repetible: Boolean, llamada: () -> Respuesta, leer: (JsonObject) -> T): Resultado<T> {
        val dudoso = if (repetible) Resultado.SinConexion else Resultado.Incierto
        val r = try {
            llamada()
        } catch (_: ConnectException) {
            return Resultado.SinConexion // no llegó a conectar: no se mandó nada
        } catch (_: UnknownHostException) {
            return Resultado.SinConexion
        } catch (_: NoRouteToHostException) {
            return Resultado.SinConexion
        } catch (_: IOException) {
            return dudoso
        }
        if (r.estado == 201) {
            return try {
                Resultado.Ok(leer(r.cuerpo!!))
            } catch (_: RuntimeException) {
                dudoso // hecho en el servidor, pero la respuesta no se entiende
            }
        }
        if (r.estado == 426) return Resultado.AppDesactualizada
        if (r.estado == 408 || r.estado in 500..599) return dudoso
        val error = r.cuerpo?.get("error") as? JsonObject
        val codigo = texto(error?.get("codigo"))
        val motivo = when (codigo) {
            "codigo_invalido" -> Rechazo.CODIGO_INVALIDO
            "viaje_completo" -> Rechazo.VIAJE_COMPLETO
            "demasiados_intentos" -> Rechazo.DEMASIADOS_INTENTOS
            "demasiadas_invitaciones" -> Rechazo.DEMASIADAS_INVITACIONES
            "solo_organizador" -> Rechazo.SOLO_ORGANIZADOR
            "formato_invalido" -> Rechazo.DATOS_INVALIDOS
            // 401 (no_autorizado, dispositivo_revocado) y 429 sin cuerpo se reconocen por el estado
            else -> if (r.estado == 429) Rechazo.DEMASIADOS_INTENTOS else if (r.estado == 401) Rechazo.REVOCADO else Rechazo.OTRO
        }
        return Resultado.Rechazado(motivo, texto(error?.get("mensaje")), r.reintentarEnMs)
    }

    private fun credenciales(o: JsonObject) =
        Credenciales(texto(o["trip_id"])!!, texto(o["device_id"])!!, texto(o["member_id"])!!, texto(o["token"])!!)

    private fun perfil(p: Perfil) = mapOf(
        "nombre_dispositivo" to JsonPrimitive(p.nombreDelDispositivo),
        "apodo" to JsonPrimitive(p.apodo),
        "color" to JsonPrimitive(p.color),
        "emoji" to JsonPrimitive(p.emoji),
    )

    /**
     * Crea el viaje con este celular como organizador. Si la respuesta se pierde, el viaje pudo quedar creado en el
     * servidor sin que el celular lo sepa: volver a probar crea otro.
     */
    fun crearViaje(viaje: ViajeNuevo, quien: Perfil): Resultado<Credenciales> = resultado(false, {
        pedir(
            "/v1/trips",
            JsonObject(
                mapOf(
                    "nombre" to JsonPrimitive(viaje.nombre),
                    "zona_horaria" to JsonPrimitive(viaje.zonaHoraria),
                    "fecha_inicio" to (viaje.fechaInicio?.let(::JsonPrimitive) ?: JsonNull),
                    "fecha_fin" to (viaje.fechaFin?.let(::JsonPrimitive) ?: JsonNull),
                    "monedas" to JsonArray(
                        viaje.monedas.map {
                            JsonObject(mapOf("codigo" to JsonPrimitive(it.codigo), "decimales" to JsonPrimitive(it.decimales), "simbolo" to JsonPrimitive(it.simbolo)))
                        },
                    ),
                ) + perfil(quien),
            ),
        )
    }, ::credenciales)

    /** Se une con un código de invitación como integrante nuevo. */
    fun unirse(codigo: String, quien: Perfil): Resultado<Credenciales> = resultado(false, {
        pedir("/v1/join", JsonObject(mapOf("codigo" to JsonPrimitive(codigo)) + perfil(quien)))
    }, ::credenciales)

    /** Se une con una invitación de reemplazo: queda como el integrante de siempre (con su apodo, color y emoji). */
    fun reemplazar(codigo: String, nombreDelDispositivo: String): Resultado<Credenciales> = resultado(false, {
        pedir("/v1/join", JsonObject(mapOf("codigo" to JsonPrimitive(codigo), "nombre_dispositivo" to JsonPrimitive(nombreDelDispositivo))))
    }, ::credenciales)

    /** Pide un código para sumar a alguien (o para reemplazar el celular de un integrante). */
    fun invitar(c: Credenciales, reemplazaA: String? = null): Resultado<Invitacion> = resultado(true, {
        pedir("/v1/trips/${c.viaje}/invitations", JsonObject(mapOf("reemplaza_member_id" to (reemplazaA?.let(::JsonPrimitive) ?: JsonNull))), c.token)
    }) { o -> Invitacion(texto(o["codigo"])!!, (o["vence_en"] as JsonPrimitive).content.toLong()) }
}
