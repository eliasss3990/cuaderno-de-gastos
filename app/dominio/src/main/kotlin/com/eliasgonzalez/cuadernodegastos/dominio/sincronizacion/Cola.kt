// La cola de salida del celular: la misma tabla de operaciones, con el estado de cada una frente al servidor. Va sobre el
// mismo almacén que el motor (misma transacción): guardar un gasto es aplicarlo y encolarlo a la vez.
package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Almacen
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada

enum class EstadoOp {
    /** Propia, esperando subir. */
    PENDIENTE,

    /** Propia, en un lote que se está subiendo: ya no se puede descartar, solo deshacer con otra operación. */
    ENVIANDO,

    /** Aceptada por el servidor (propia o bajada). */
    CONFIRMADA,

    /** Propia rechazada por el servidor (o dependiente de una rechazada): se puede reintentar o descartar. */
    CUARENTENA,
}

/** Una operación del registro local con su estado frente al servidor. `orden` es el orden en que se aplicó en el celular. */
data class OpEnCola(
    val op: OpGuardada,
    val estado: EstadoOp,
    val orden: Long,
    val serverSeq: Long? = null,
    val razon: String? = null,
    val intentos: Int = 0,
    val proximoIntentoEn: Long? = null,
    /** La operación propia de la que depende (rechazada esa, esta también). */
    val dependeDe: String? = null,
)

/** Lo que el celular guarda de su vínculo con un viaje. */
data class ViajeLocal(
    val dispositivo: String,
    val integrante: String,
    /** Última secuencia del servidor aplicada. */
    val ultimoSeq: Long = 0,
    /** Hora del servidor menos hora del celular, aprendida en cada respuesta. */
    val desfaseMs: Long = 0,
    /** Última marca propia emitida u observada: nunca retrocede (las descartadas también la consumieron). */
    val hlcUltimo: String? = null,
    val ultimaSyncOkEn: Long? = null,
    val revocado: Boolean = false,
)

interface Cola : Almacen {
    /**
     * Fija el estado de una operación ya guardada por el motor (las guarda CONFIRMADA y sin secuencia). Una propia recién
     * registrada pasa a PENDIENTE; una bajada queda CONFIRMADA con su secuencia. Reemplaza los cuatro datos: lo que no
     * se pasa queda vacío (volver a PENDIENTE una op en cuarentena borra su razón).
     */
    fun fijarEstado(opId: String, estado: EstadoOp, serverSeq: Long? = null, razon: String? = null, dependeDe: String? = null)

    fun buscarEnCola(opId: String): OpEnCola?

    /** Las operaciones en ese estado (CONFIRMADA incluye las bajadas), en el orden en que se aplicaron, hasta `limite`. */
    fun enEstado(estado: EstadoOp, limite: Int = Int.MAX_VALUE): List<OpEnCola>

    /** Todas las operaciones de una entidad, en el orden en que se aplicaron (para recalcularla). */
    fun opsDeEntidad(tipo: String, id: String): List<OpEnCola>

    /** Las operaciones cuyo padre es `padreId` (las de los adjuntos de un gasto), en orden. */
    fun opsConPadre(padreId: String): List<OpEnCola>

    /** Cambia la marca de una operación (el servidor la corrigió). La nueva no puede estar en uso. */
    fun cambiarMarca(opId: String, hlc: String)

    /** Borra la entidad y sus campos sin dejar lápida (y sin quitar una que ya hubiera): para rehacerla desde el registro. */
    fun borrarEntidad(tipo: String, id: String)

    /** Quita la lápida de una entidad (solo para deshacer una que nació de una op propia descartada). */
    fun quitarLapida(tipo: String, id: String)

    /** Anota un intento fallido de subirla y cuándo volver a probar. */
    fun anotarIntento(opId: String, proximoIntentoEn: Long?)

    /** Borra la operación del registro (descartar una propia que nunca llegó al servidor): solo PENDIENTE o CUARENTENA. */
    fun borrarOp(opId: String)

    fun viajeLocal(): ViajeLocal?

    fun guardarViajeLocal(v: ViajeLocal)
}
