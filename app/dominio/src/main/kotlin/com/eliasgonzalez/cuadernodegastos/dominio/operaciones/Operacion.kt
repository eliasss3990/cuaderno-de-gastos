// Una operación: el cambio mínimo que la app registra y sincroniza (alta, edición o baja de una entidad del viaje).
package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import kotlinx.serialization.json.JsonObject

data class Operacion(
    val opId: String,
    val tipo: String,
    val entidadTipo: String,
    val entidadId: String,
    val hlc: String,
    /** Los campos que cambia, tal como viajan (JSON). */
    val payload: JsonObject,
    /** Versión del formato de la operación (`schema_version` en el cable). */
    val schemaVersion: Int,
)
