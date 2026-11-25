// Recepción de un lote de operaciones de un dispositivo: por cada una, en una transacción propia, que la marca sea del
// dispositivo que la envía, la corrección de marcas del futuro y la ingesta; un duplicado devuelve la secuencia y la marca
// final de la primera vez. Es la del servidor: en la app la usa el simulador como servidor de prueba.
package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.dominio.base.Instante
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj

/** Resultado de una operación del lote; `hlc` es la marca final (la enviada, la corregida o, en un duplicado, la guardada). */
data class ResultadoDeOperacion(val opId: String, val estado: Estado, val seq: Long? = null, val razon: Razon? = null, val hlc: String) {
    enum class Estado { ACEPTADA, DUPLICADA, RECHAZADA }
}

class LoteInvalidoError(mensaje: String) : IllegalArgumentException(mensaje)

/** Lo que la recepción necesita además del almacén del motor (en el servidor lo tiene el almacén de SQLite). */
interface AlmacenDelServidor : Almacen {
    /** Secuencia y marca final de una operación guardada, o null. */
    fun buscarOp(opId: String): Pair<Long, String>?

    /** La mayor marca guardada de ese dispositivo, o null. */
    fun ultimaMarcaDe(dispositivo: String): String?
}

class Recepcion(private val almacen: AlmacenDelServidor, private val ahora: () -> Long) {
    companion object {
        const val MAX_OPERACIONES_POR_LOTE = 100

        /** Índice donde empieza el dispositivo en una marca: 13 de milisegundos, guion, 4 del contador y otro guion. */
        private const val DISPOSITIVO_DESDE = 19
    }

    private val ingesta = Ingesta(almacen, ahora)

    fun procesarLote(ops: List<Operacion>, dispositivo: String): List<ResultadoDeOperacion> {
        if (ops.isEmpty()) throw LoteInvalidoError("el lote está vacío")
        if (ops.size > MAX_OPERACIONES_POR_LOTE) throw LoteInvalidoError("el lote tiene más de $MAX_OPERACIONES_POR_LOTE operaciones")
        return ops.map { procesar(it, dispositivo) }
    }

    private fun procesar(op: Operacion, dispositivo: String): ResultadoDeOperacion = almacen.transaccion {
        fun rechazada(razon: Razon) = ResultadoDeOperacion(op.opId, ResultadoDeOperacion.Estado.RECHAZADA, razon = razon, hlc = op.hlc)
        val marca = Reloj.parsear(op.hlc)
        if (marca == null || marca.dispositivo != dispositivo) return@transaccion rechazada(Razon.FORMATO)
        // un op_id ya guardado por otro dispositivo no se puede repetir ni devolver como duplicado
        val previa = almacen.buscarOp(op.opId)
        if (previa != null && previa.second.substring(DISPOSITIVO_DESDE) != dispositivo) return@transaccion rechazada(Razon.FORMATO)

        val ultima = almacen.ultimaMarcaDe(dispositivo)?.let { Reloj.parsear(it) }
        val corregida = Reloj.corregirFuturo(marca, ahora(), ultima?.let { Instante(it.ms, it.contador) })
        val enviada = if (corregida.corregida) op.copy(hlc = Reloj.formatear(corregida.hlc)) else op
        when (val r = ingesta.procesar(enviada)) {
            is Resultado.Rechazada -> rechazada(r.razon)
            else -> {
                // lo que se devuelve es lo que quedó guardado: en un duplicado, la secuencia y la marca de la primera vez
                val (seq, hlc) = checkNotNull(almacen.buscarOp(op.opId)) { "la operación aceptada no quedó guardada" }
                val estado = if (r is Resultado.Duplicada) ResultadoDeOperacion.Estado.DUPLICADA else ResultadoDeOperacion.Estado.ACEPTADA
                ResultadoDeOperacion(op.opId, estado, seq, hlc = hlc)
            }
        }
    }
}
