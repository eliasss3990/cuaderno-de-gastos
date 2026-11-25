// Almacén del estado de un viaje sobre la base local. Cumple el mismo contrato que el de memoria y se prueba con las
// mismas pruebas. Una instancia atiende a un solo viaje (`tripId`): todas las consultas van acotadas a él.
package com.eliasgonzalez.cuadernodegastos.datos

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.IntervaloCierre
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Cola
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.OpEnCola
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.ViajeLocal
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

class AlmacenSqlite(private val base: BaseSql, private val tripId: String) : Cola {
    private fun texto(f: Fila, i: Int) = f[i] as String

    private fun hay(sql: String, vararg args: Any?) = base.consultar(sql, *args).isNotEmpty()

    override fun <T> transaccion(fn: () -> T): T = base.transaccion(fn)

    override fun opConocida(opId: String) = hay("SELECT 1 FROM op WHERE trip_id = ? AND op_id = ?", tripId, opId)

    override fun marcaEnUso(hlc: String) = hay("SELECT 1 FROM op WHERE trip_id = ? AND hlc = ?", tripId, hlc)

    override fun entidadExiste(tipo: String, id: String) = hay("SELECT 1 FROM entity WHERE trip_id = ? AND tipo = ? AND id = ?", tripId, tipo, id)

    override fun entidadTerminada(tipo: String, id: String) = hay("SELECT 1 FROM entity_tombstone WHERE trip_id = ? AND tipo = ? AND id = ?", tripId, tipo, id)

    override fun leerCampo(tipo: String, id: String, campo: String): JsonElement? =
        base.consultar("SELECT valor FROM entity_field WHERE trip_id = ? AND tipo = ? AND id = ? AND campo = ?", tripId, tipo, id, campo)
            .firstOrNull()?.let { Json.parseToJsonElement(texto(it, 0)) }

    override fun leerReloj(tipo: String, id: String, campo: String): String? =
        base.consultar("SELECT hlc FROM entity_field WHERE trip_id = ? AND tipo = ? AND id = ? AND campo = ?", tripId, tipo, id, campo)
            .firstOrNull()?.let { texto(it, 0) }

    override fun crearEntidad(tipo: String, id: String) {
        base.ejecutar("INSERT OR IGNORE INTO entity (trip_id, tipo, id) VALUES (?, ?, ?)", tripId, tipo, id)
    }

    // sin UPSERT (SQLite 3.18): se actualiza y, si no había fila, se inserta. El valor se guarda siempre con
    // JsonElement.toString(): adjuntosDe compara ese texto
    override fun escribirCampo(tipo: String, id: String, campo: String, valor: JsonElement, hlc: String) {
        check(entidadExiste(tipo, id)) { "la entidad $tipo/$id no existe" }
        val json = valor.toString()
        val cambiadas = base.ejecutar("UPDATE entity_field SET valor = ?, hlc = ? WHERE trip_id = ? AND tipo = ? AND id = ? AND campo = ?", json, hlc, tripId, tipo, id, campo)
        if (cambiadas == 0) base.ejecutar("INSERT INTO entity_field (trip_id, tipo, id, campo, valor, hlc) VALUES (?, ?, ?, ?, ?, ?)", tripId, tipo, id, campo, json, hlc)
    }

    override fun adjuntosDe(ownerId: String): List<String> =
        base.consultar("SELECT id FROM entity_field WHERE trip_id = ? AND tipo = 'attachment' AND campo = 'owner_id' AND valor = ? ORDER BY id", tripId, JsonPrimitive(ownerId).toString())
            .map { texto(it, 0) }

    // sin depender de las claves foráneas (en Android vienen apagadas): los campos se borran a mano
    override fun terminar(tipo: String, id: String) {
        base.ejecutar("DELETE FROM entity_field WHERE trip_id = ? AND tipo = ? AND id = ?", tripId, tipo, id)
        base.ejecutar("DELETE FROM entity WHERE trip_id = ? AND tipo = ? AND id = ?", tripId, tipo, id)
        base.ejecutar("INSERT OR IGNORE INTO entity_tombstone (trip_id, tipo, id) VALUES (?, ?, ?)", tripId, tipo, id)
    }

    override fun redactarPorEntidad(tipo: String, id: String) {
        base.ejecutar("UPDATE op SET payload = NULL, redactada = 1 WHERE trip_id = ? AND entity_type = ? AND entity_id = ?", tripId, tipo, id)
    }

    override fun redactarPorPadre(padreId: String) {
        base.ejecutar("UPDATE op SET payload = NULL, redactada = 1 WHERE trip_id = ? AND padre_id = ?", tripId, padreId)
    }

    override fun padreRegistrado(tipo: String, id: String): String? =
        base.consultar("SELECT padre_id FROM op WHERE trip_id = ? AND entity_type = ? AND entity_id = ? AND padre_id IS NOT NULL ORDER BY local_id LIMIT 1", tripId, tipo, id)
            .firstOrNull()?.let { texto(it, 0) }

    override fun guardarOp(op: OpGuardada): Long {
        // la secuencia es la posición de la operación en el viaje (1, 2, 3… sin huecos), no el local_id de la tabla
        val seq = (base.consultar("SELECT COALESCE(MAX(seq), 0) + 1 FROM op WHERE trip_id = ?", tripId).single()[0] as Long)
        base.ejecutar(
            "INSERT INTO op (trip_id, op_id, seq, entity_type, entity_id, padre_id, type, hlc, payload, redactada, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            tripId, op.opId, seq, op.entidadTipo, op.entidadId, op.padreId, op.tipo, op.hlc, op.payload?.toString(), if (op.redactada) 1L else 0L, op.schemaVersion.toLong(),
        )
        return seq
    }

    override fun idDelViaje(): String? =
        base.consultar("SELECT id FROM entity WHERE trip_id = ? AND tipo = 'trip' ORDER BY id LIMIT 1", tripId).firstOrNull()?.let { texto(it, 0) }

    override fun contarEntidades(tipo: String): Int = (base.consultar("SELECT COUNT(*) FROM entity WHERE trip_id = ? AND tipo = ?", tripId, tipo).single()[0] as Long).toInt()

    override fun intervalosDeCierre(): List<IntervaloCierre> =
        base.consultar("SELECT desde_ms, hasta_ms, causa FROM trip_closed_interval WHERE trip_id = ? ORDER BY desde_ms", tripId)
            .map { IntervaloCierre(it[0] as Long, it[1] as Long?, IntervaloCierre.Causa.valueOf(texto(it, 2))) }

    private fun ultimoIntervalo() =
        base.consultar("SELECT desde_ms, hasta_ms FROM trip_closed_interval WHERE trip_id = ? ORDER BY desde_ms DESC LIMIT 1", tripId).firstOrNull()

    override fun abrirIntervalo(desdeMs: Long, causa: IntervaloCierre.Causa) {
        val ultimo = ultimoIntervalo()
        check(ultimo == null || (ultimo[1] != null && desdeMs >= ultimo[1] as Long)) { "el intervalo se superpone con el anterior" }
        base.ejecutar("INSERT INTO trip_closed_interval (trip_id, desde_ms, hasta_ms, causa) VALUES (?, ?, NULL, ?)", tripId, desdeMs, causa.name)
    }

    override fun cerrarIntervalo(hastaMs: Long) {
        val ultimo = ultimoIntervalo()
        check(ultimo != null && ultimo[1] == null) { "no hay un intervalo abierto" }
        val desde = ultimo[0] as Long
        check(hastaMs > desde) { "el fin debe ser posterior al inicio" }
        base.ejecutar("UPDATE trip_closed_interval SET hasta_ms = ? WHERE trip_id = ? AND desde_ms = ?", hastaMs, tripId, desde)
    }

    // ---- cola -------------------------------------------------------------------------------------

    private val COLUMNAS_COLA = "op_id, type, entity_type, entity_id, hlc, payload, redactada, padre_id, schema_version, estado, seq, server_seq, razon_rechazo, intentos, proximo_intento_en, depende_de"

    private fun opEnCola(f: Fila) = OpEnCola(
        op = OpGuardada(
            texto(f, 0), texto(f, 1), texto(f, 2), texto(f, 3), texto(f, 4),
            (f[5] as String?)?.let { Json.parseToJsonElement(it).jsonObject }, f[6] as Long == 1L, f[7] as String?, (f[8] as Long).toInt(),
        ),
        estado = EstadoOp.valueOf(texto(f, 9)),
        orden = f[10] as Long,
        serverSeq = f[11] as Long?,
        razon = f[12] as String?,
        intentos = (f[13] as Long).toInt(),
        proximoIntentoEn = f[14] as Long?,
        dependeDe = f[15] as String?,
    )

    private fun existeOp(opId: String) = check(opConocida(opId)) { "la operación $opId no está guardada" }

    override fun fijarEstado(opId: String, estado: EstadoOp, serverSeq: Long?, razon: String?, dependeDe: String?) {
        existeOp(opId)
        base.ejecutar("UPDATE op SET estado = ?, server_seq = ?, razon_rechazo = ?, depende_de = ? WHERE trip_id = ? AND op_id = ?", estado.name, serverSeq, razon, dependeDe, tripId, opId)
    }

    override fun buscarEnCola(opId: String): OpEnCola? =
        base.consultar("SELECT $COLUMNAS_COLA FROM op WHERE trip_id = ? AND op_id = ?", tripId, opId).firstOrNull()?.let { opEnCola(it) }

    override fun enEstado(estado: EstadoOp, limite: Int): List<OpEnCola> =
        base.consultar("SELECT $COLUMNAS_COLA FROM op WHERE trip_id = ? AND estado = ? ORDER BY seq LIMIT ?", tripId, estado.name, limite.toLong()).map { opEnCola(it) }

    override fun opsDeEntidad(tipo: String, id: String): List<OpEnCola> =
        base.consultar("SELECT $COLUMNAS_COLA FROM op WHERE trip_id = ? AND entity_type = ? AND entity_id = ? ORDER BY seq", tripId, tipo, id).map { opEnCola(it) }

    override fun cambiarMarca(opId: String, hlc: String) {
        existeOp(opId)
        base.ejecutar("UPDATE op SET hlc = ? WHERE trip_id = ? AND op_id = ?", hlc, tripId, opId)
    }

    override fun borrarEntidad(tipo: String, id: String) {
        base.ejecutar("DELETE FROM entity_field WHERE trip_id = ? AND tipo = ? AND id = ?", tripId, tipo, id)
        base.ejecutar("DELETE FROM entity WHERE trip_id = ? AND tipo = ? AND id = ?", tripId, tipo, id)
    }

    override fun anotarIntento(opId: String, proximoIntentoEn: Long?) {
        existeOp(opId)
        base.ejecutar("UPDATE op SET intentos = intentos + 1, proximo_intento_en = ? WHERE trip_id = ? AND op_id = ?", proximoIntentoEn, tripId, opId)
    }

    override fun borrarOp(opId: String) {
        buscarEnCola(opId)?.let { check(it.estado == EstadoOp.PENDIENTE || it.estado == EstadoOp.CUARENTENA) { "solo se descarta una op que el servidor no tiene" } }
        base.ejecutar("DELETE FROM op WHERE trip_id = ? AND op_id = ?", tripId, opId)
    }

    override fun viajeLocal(): ViajeLocal? =
        base.consultar("SELECT device_id, member_id, ultimo_seq, desfase_ms, hlc_ultimo, ultima_sync_ok_en, revocado FROM trip_local WHERE trip_id = ?", tripId).firstOrNull()?.let {
            ViajeLocal(texto(it, 0), texto(it, 1), it[2] as Long, it[3] as Long, it[4] as String?, it[5] as Long?, it[6] as Long == 1L)
        }

    // sin UPSERT (SQLite 3.18): una sola sentencia que reemplaza la fila
    override fun guardarViajeLocal(v: ViajeLocal) {
        base.ejecutar(
            "INSERT OR REPLACE INTO trip_local (trip_id, device_id, member_id, ultimo_seq, desfase_ms, hlc_ultimo, ultima_sync_ok_en, revocado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            tripId, v.dispositivo, v.integrante, v.ultimoSeq, v.desfaseMs, v.hlcUltimo, v.ultimaSyncOkEn, if (v.revocado) 1L else 0L,
        )
    }

    /** Números de secuencia de las operaciones guardadas (para comprobar que no hay huecos). */
    fun secuencias(): List<Long> = base.consultar("SELECT seq FROM op WHERE trip_id = ? ORDER BY seq", tripId).map { it[0] as Long }

    /** Vista ordenada del estado, con la misma forma que la del almacén en memoria (para compararlos). */
    fun instantanea(): JsonObject {
        val campos = base.consultar("SELECT tipo, id, campo, valor, hlc FROM entity_field WHERE trip_id = ? ORDER BY tipo, id, campo", tripId)
            .groupBy { texto(it, 0) to texto(it, 1) }
        val entidades = base.consultar("SELECT tipo, id FROM entity WHERE trip_id = ? ORDER BY tipo, id", tripId).map { e ->
            val filas = campos[texto(e, 0) to texto(e, 1)].orEmpty()
            JsonObject(
                mapOf(
                    "tipo" to JsonPrimitive(texto(e, 0)),
                    "id" to JsonPrimitive(texto(e, 1)),
                    "campos" to JsonObject(filas.associate { texto(it, 2) to Json.parseToJsonElement(texto(it, 3)) }),
                    "relojes" to JsonObject(filas.associate { texto(it, 2) to JsonPrimitive(texto(it, 4)) }),
                ),
            )
        }
        val lapidas = base.consultar("SELECT tipo, id FROM entity_tombstone WHERE trip_id = ? ORDER BY tipo, id", tripId)
            .map { JsonObject(mapOf("tipo" to JsonPrimitive(texto(it, 0)), "id" to JsonPrimitive(texto(it, 1)))) }
        val ops = base.consultar("SELECT op_id, type, entity_type, entity_id, hlc, payload, redactada, padre_id FROM op WHERE trip_id = ? ORDER BY op_id", tripId).map {
            JsonObject(
                mapOf(
                    "opId" to JsonPrimitive(texto(it, 0)),
                    "tipo" to JsonPrimitive(texto(it, 1)),
                    "entidadTipo" to JsonPrimitive(texto(it, 2)),
                    "entidadId" to JsonPrimitive(texto(it, 3)),
                    "hlc" to JsonPrimitive(texto(it, 4)),
                    "payload" to ((it[5] as String?)?.let { p -> Json.parseToJsonElement(p).jsonObject } ?: JsonNull),
                    "redactada" to JsonPrimitive(it[6] as Long == 1L),
                    "padreId" to ((it[7] as String?)?.let { p -> JsonPrimitive(p) } ?: JsonNull),
                ),
            )
        }
        return JsonObject(mapOf("entidades" to JsonArray(entidades), "lapidas" to JsonArray(lapidas), "ops" to JsonArray(ops)))
    }
}
