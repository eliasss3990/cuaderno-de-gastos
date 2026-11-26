// Ids nuevos para operaciones y entidades: UUID v7 en minúsculas (la hora arriba, así se ordenan por cuándo se crearon;
// el resto al azar). Es el formato que exige la validación de las operaciones.
package com.eliasgonzalez.cuadernodegastos.dominio.base

import java.security.SecureRandom
import java.util.UUID

object Ids {
    private val azar = SecureRandom()

    fun nuevo(ahoraMs: Long = System.currentTimeMillis()): String {
        require(ahoraMs in 0..0xFFFF_FFFF_FFFFL) { "la hora no entra en 48 bits" }
        val bytes = ByteArray(10).also { azar.nextBytes(it) }
        val r = java.nio.ByteBuffer.wrap(bytes)
        val alto = (ahoraMs shl 16) or 0x7000L or (r.short.toLong() and 0x0FFF)
        val bajo = (r.long and 0x3FFF_FFFF_FFFF_FFFFL) or Long.MIN_VALUE // variante 10
        return UUID(alto, bajo).toString()
    }
}
