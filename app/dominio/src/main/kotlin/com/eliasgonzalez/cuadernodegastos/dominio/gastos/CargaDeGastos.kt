// Cargar y editar un gasto: los valores con que arranca el formulario, la operación de alta, la de edición (solo lo que
// cambió) y las sugerencias de lo ya escrito. Puro: quien llama registra la operación y muestra el resultado.
package com.eliasgonzalez.cuadernodegastos.dominio.gastos

import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Gasto
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Lo que tiene el formulario al guardar. Los textos vacíos o solo con espacios cuentan como "sin dato". */
data class BorradorDeGasto(
    val montoMinor: Long,
    val moneda: String,
    val categoriaId: String,
    val cuandoOcurrio: Long,
    val diaImputado: String,
    val concepto: String? = null,
    val lugar: String? = null,
    val metodoPago: String? = null,
    val aliasTarjeta: String? = null,
    val nota: String? = null,
)

/** Lo gastado contra el tope del viaje: dentro, ya pasado sin este gasto, o pasado justo con este. */
enum class AvisoDelTope { NINGUNO, YA_PASADO, PASA_CON_ESTE }

/** Con qué arranca el formulario de un gasto nuevo. */
data class ValoresPorDefecto(val moneda: String, val categoriaId: String, val metodoPago: String?, val diaImputado: String)

object CargaDeGastos {
    /** La categoría que existe siempre y no se archiva. */
    const val OTRO = "otro"

    /** Los métodos de pago que llevan alias de tarjeta. */
    val CON_TARJETA = setOf("CREDITO", "DEBITO")

    /**
     * Moneda, categoría y método: los del último gasto propio (si no hay, el último de cualquiera); sin gastos, la
     * primera moneda habilitada y "Otro". Una moneda deshabilitada o una categoría archivada no se proponen. El día es
     * el de hoy en la zona del viaje.
     */
    fun porDefecto(
        gastos: List<Gasto>,
        monedasHabilitadas: List<String>,
        categoriasActivas: Set<String>,
        yo: String?,
        zonaHoraria: String,
        ahoraMs: Long,
        /** El último día del viaje: pasado el fin, el día propuesto es ese (hoy ya no se puede cargar). */
        fechaFin: String? = null,
    ): ValoresPorDefecto {
        // el último cargado: por cuándo ocurrió, de más nuevo a más viejo
        val vigentes = gastos.filter { !it.eliminado }.sortedByDescending { it.cuandoOcurrio }
        val ultimo = vigentes.firstOrNull { yo != null && it.autor == yo } ?: vigentes.firstOrNull()
        val moneda = ultimo?.moneda?.takeIf { it in monedasHabilitadas } ?: monedasHabilitadas.firstOrNull() ?: ""
        val categoria = ultimo?.categoriaId?.takeIf { it in categoriasActivas } ?: OTRO
        val hoy = EstadoDelViaje.diaEn(ahoraMs, zonaHoraria)
        return ValoresPorDefecto(moneda, categoria, ultimo?.metodoPago, if (fechaFin != null && hoy > fechaFin) fechaFin else hoy)
    }

    private fun limpio(t: String?): String? = t?.trim()?.takeIf { it.isNotEmpty() }

    /** El alias solo va con tarjeta. */
    private fun alias(b: BorradorDeGasto) = if (b.metodoPago in CON_TARJETA) limpio(b.aliasTarjeta) else null

    private fun campos(b: BorradorDeGasto): Map<String, JsonElement?> = linkedMapOf(
        "monto_minor" to JsonPrimitive(b.montoMinor),
        "moneda" to JsonPrimitive(b.moneda),
        "categoria_id" to JsonPrimitive(b.categoriaId),
        "cuando_ocurrio" to JsonPrimitive(b.cuandoOcurrio),
        "dia_imputado" to JsonPrimitive(b.diaImputado),
        "concepto" to limpio(b.concepto)?.let(::JsonPrimitive),
        "lugar" to limpio(b.lugar)?.let(::JsonPrimitive),
        "metodo_pago" to b.metodoPago?.let(::JsonPrimitive),
        "alias_tarjeta" to alias(b)?.let(::JsonPrimitive),
        "nota" to limpio(b.nota)?.let(::JsonPrimitive),
    )

    /** El alta: sin los campos vacíos. */
    fun alta(b: BorradorDeGasto, opId: String, gastoId: String, marca: String): Operacion =
        Operacion(opId, "expense.create", "expense", gastoId, marca, JsonObject(campos(b).filterValues { it != null }.mapValues { it.value!! }), 1)

    /**
     * La edición: solo lo que cambió respecto de `antes` (cuándo ocurrió no se toca: lo cambia otra acción) (un campo que se vació viaja como null, que lo borra), o null
     * si no cambió nada. Mandar solo lo cambiado evita pisar lo que otro editó en otro campo.
     */
    fun edicion(antes: Gasto, b: BorradorDeGasto, opId: String, marca: String): Operacion? {
        val previos: Map<String, JsonElement?> = campos(
            BorradorDeGasto(
                antes.montoMinor, antes.moneda, antes.categoriaId, antes.cuandoOcurrio, antes.diaImputado,
                antes.concepto, antes.lugar, antes.metodoPago, antes.aliasTarjeta, antes.nota,
            ),
        )
        val nuevos = campos(b.copy(cuandoOcurrio = antes.cuandoOcurrio))
        val distintos = nuevos.filter { (campo, valor) -> valor != previos[campo] }.keys
        // monto y moneda son un solo dato: si cambia uno viajan los dos (si no, con otro celular podrían quedar mezclados)
        val juntos = if (distintos.any { it == "monto_minor" || it == "moneda" }) distintos + setOf("monto_minor", "moneda") else distintos
        val cambios = nuevos.filterKeys { it in juntos }.mapValues { it.value ?: JsonNull }
        return if (cambios.isEmpty()) null else Operacion(opId, "expense.update", "expense", antes.id, marca, JsonObject(cambios), 1)
    }

    /** [g] con los [campos] (los nombres que arma [edicion]) tomados de [b]: cómo queda un gasto tras aplicar una edición. */
    fun conCampos(g: Gasto, b: BorradorDeGasto, campos: Set<String>): Gasto = g.copy(
        montoMinor = if ("monto_minor" in campos) b.montoMinor else g.montoMinor,
        moneda = if ("moneda" in campos) b.moneda else g.moneda,
        categoriaId = if ("categoria_id" in campos) b.categoriaId else g.categoriaId,
        diaImputado = if ("dia_imputado" in campos) b.diaImputado else g.diaImputado,
        concepto = if ("concepto" in campos) limpio(b.concepto) else g.concepto,
        lugar = if ("lugar" in campos) limpio(b.lugar) else g.lugar,
        metodoPago = if ("metodo_pago" in campos) b.metodoPago else g.metodoPago,
        aliasTarjeta = if ("alias_tarjeta" in campos) alias(b) else g.aliasTarjeta,
        nota = if ("nota" in campos) limpio(b.nota) else g.nota,
    )

    /** Lo gastado en todo el viaje por moneda (sin la papelera), para comparar con el tope. */
    fun gastadoPorMoneda(gastos: List<Gasto>): Map<String, Long> =
        gastos.filter { !it.eliminado }.groupBy { it.moneda }.mapValues { (_, g) -> g.sumOf { it.montoMinor } }

    /**
     * Cómo queda lo gastado contra el tope del viaje en la moneda (avisa, no bloquea): ya pasado antes de este gasto, o
     * pasado justo con este; sin tope, nunca avisa.
     */
    fun avisoDelTope(montoMinor: Long, gastadoMinor: Long, topeMinor: Long?): AvisoDelTope = when {
        topeMinor == null || topeMinor <= 0 -> AvisoDelTope.NINGUNO
        gastadoMinor > topeMinor -> AvisoDelTope.YA_PASADO
        gastadoMinor + montoMinor > topeMinor -> AvisoDelTope.PASA_CON_ESTE
        else -> AvisoDelTope.NINGUNO
    }

    /** Manda el gasto a la papelera (se puede restaurar). */
    fun aLaPapelera(gastoId: String, opId: String, marca: String): Operacion =
        Operacion(opId, "expense.delete", "expense", gastoId, marca, JsonObject(mapOf("eliminado" to JsonPrimitive(1))), 1)

    /** Lo saca de la papelera. */
    fun restaurar(gastoId: String, opId: String, marca: String): Operacion =
        Operacion(opId, "expense.restore", "expense", gastoId, marca, JsonObject(mapOf("eliminado" to JsonPrimitive(0))), 1)

    /** Deshacer un alta recién hecha: el gasto se elimina del todo (no va a la papelera, que es para lo que se borra a mano). */
    fun deshacerAlta(gastoId: String, opId: String, marca: String): Operacion =
        Operacion(opId, "expense.purge", "expense", gastoId, marca, JsonObject(emptyMap()), 1)

    /** Hasta `cuantos` valores distintos ya usados de un campo (lugar, concepto, alias), del más reciente al más viejo. */
    fun sugerencias(gastos: List<Gasto>, campo: (Gasto) -> String?, cuantos: Int = 5): List<String> =
        gastos.filter { !it.eliminado }.sortedByDescending { it.cuandoOcurrio }.mapNotNull { limpio(campo(it)) }.distinctBy { it.lowercase() }.take(cuantos)
}
