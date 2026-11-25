// Validación de formato de una operación, sin mirar el estado: tipo conocido, campos permitidos para ese tipo,
// campos obligatorios, y el tipo, el rango y el formato de cada valor. Es la misma que la del servidor: lo que
// uno rechaza, el otro también. Los números siguen las reglas de JSON en JavaScript (1.0 es el entero 1).
package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import com.eliasgonzalez.cuadernodegastos.dominio.base.Dinero
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

sealed interface ResultadoValidacion {
    data object Ok : ResultadoValidacion

    data class Rechazada(val campo: String, val motivo: String) : ResultadoValidacion
}

/** Devuelve el motivo del rechazo, o null si el valor es válido. */
private typealias Regla = (JsonElement) -> String?

object Validacion {
    /** Tamaños máximos de los adjuntos, en bytes. */
    const val MAX_BYTES_IMAGEN = 5L * 1024 * 1024
    const val MAX_BYTES_PDF = 10L * 1024 * 1024

    /** La versión del formato de las operaciones que genera esta app. */
    const val VERSION_DE_FORMATO = 1

    /** Las versiones del formato que la app entiende. */
    val VERSIONES_DE_FORMATO: Set<Int> = setOf(VERSION_DE_FORMATO)

    private const val MAX_ENTERO_SEGURO = 9_007_199_254_740_991.0

    // ---- números como en JavaScript ---------------------------------------------------------------

    /** El número de un valor JSON como lo ve JavaScript, o null si no es un número. */
    private fun numero(v: JsonElement): Double? {
        if (v !is JsonPrimitive || v.isString || v is JsonNull) return null
        return v.content.toDoubleOrNull() // true y false no son números
    }

    /** -0 (o -0.0, -0e5): JavaScript lo distingue del 0 y las reglas lo rechazan. */
    private fun esMenosCero(v: JsonElement, n: Double) = n == 0.0 && (1.0 / n < 0 || (v as JsonPrimitive).content.startsWith("-"))

    /** El valor como entero seguro de JavaScript (`Number.isSafeInteger` y no -0), o null. */
    private fun enteroSeguro(v: JsonElement): Long? {
        val n = numero(v) ?: return null
        if (n.isNaN() || n != Math.floor(n) || kotlin.math.abs(n) > MAX_ENTERO_SEGURO || esMenosCero(v, n)) return null
        return n.toLong()
    }

    private fun texto(v: JsonElement): String? = if (v is JsonPrimitive && v.isString) v.content else null

    // ---- reglas de valor --------------------------------------------------------------------------

    private fun entero(min: Long, max: Long): Regla = { v ->
        val n = enteroSeguro(v)
        when {
            n == null -> "debe ser un entero"
            n < min || n > max -> "debe estar entre $min y $max"
            else -> null
        }
    }

    private fun exacto(n: Long): Regla = { v -> if (enteroSeguro(v) == n) null else "debe ser $n" }

    private val binario: Regla = { v -> if (enteroSeguro(v).let { it == 0L || it == 1L }) null else "debe ser 0 o 1" }
    private val momento: Regla = entero(0, Reloj.MAX_MS)

    // controles: en un texto de una línea, todos; en uno de varias líneas, todos salvo tabulador y salto
    private val CONTROLES = Regex("[\\u0000-\\u001f\\u007f-\\u009f]")
    private val CONTROLES_SALVO_TAB_Y_SALTO = Regex("[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f]")
    private val SUSTITUTO_SUELTO = Regex("[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]")
    private val SOLO_ESPACIOS = Regex("[ \\t\\n]*")

    private fun texto(max: Int, variasLineas: Boolean = false): Regla {
        val controles = if (variasLineas) CONTROLES_SALVO_TAB_Y_SALTO else CONTROLES
        return { v ->
            val t = texto(v)
            when {
                t == null -> "debe ser texto"
                t.isEmpty() || t.length > max -> "debe tener entre 1 y $max caracteres"
                controles.containsMatchIn(t) -> "no admite caracteres de control"
                SUSTITUTO_SUELTO.containsMatchIn(t) -> "no admite unidades Unicode sueltas"
                SOLO_ESPACIOS.matches(t) -> "no puede ser solo espacios"
                else -> null
            }
        }
    }

    /** La regla de los textos de una línea (apodo, nombres), para usarla fuera de las operaciones. */
    fun validarTextoDeUnaLinea(valor: String, max: Int): String? = texto(max)(JsonPrimitive(valor))

    // matches exige el texto entero: en Java "$" acepta un salto de línea final, en JavaScript no
    private fun conPatron(patron: String, descripcion: String): Regla {
        val r = Regex(patron)
        return { v -> if (texto(v)?.let { r.matches(it) } == true) null else "debe ser $descripcion" }
    }

    private val uuid = conPatron("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "un UUID en minúsculas")
    private val uuidOOtro: Regla = { v -> if (texto(v) == "otro") null else uuid(v) }
    private val codigoMoneda = conPatron("[A-Z]{3}", "un código de moneda de tres letras mayúsculas")
    private val color = conPatron("#[0-9A-F]{6}", "un color #RRGGBB en mayúsculas")
    private val metodoPago = conPatron("[A-Z][A-Z0-9_]{0,31}", "un código de método de pago")
    private val sha256 = conPatron("[0-9a-f]{64}", "un SHA-256 en hexadecimal minúscula")

    // el \s de JavaScript incluye los espacios Unicode; el de Java, solo los ASCII
    private val ENLACE = Regex("https?://[^\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+")
    private val enlace: Regla = { v ->
        val t = texto(v)
        if (t != null && t.length <= 500 && ENLACE.matches(t)) null else "debe ser un enlace http o https de hasta 500 caracteres"
    }

    private fun enumerado(vararg valores: String): Regla = { v -> if (texto(v) in valores) null else "debe ser uno de ${valores.joinToString(", ")}" }

    private fun numeroEntre(min: Double, max: Double): Regla = { v ->
        val n = numero(v)
        if (n != null && !esMenosCero(v, n) && n >= min && n <= max) null else "debe ser un número entre ${formatear(min)} y ${formatear(max)}"
    }

    private fun formatear(d: Double) = if (d == Math.floor(d)) d.toLong().toString() else d.toString()

    private val DIAS_DEL_MES = intArrayOf(31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    private val FECHA = Regex("([0-9]{4})-([0-9]{2})-([0-9]{2})")

    private val fecha: Regla = fecha@{ v ->
        val m = texto(v)?.let { FECHA.matchEntire(it) } ?: return@fecha "debe ser una fecha AAAA-MM-DD"
        val (anio, mes, dia) = m.destructured.toList().map { it.toInt() }
        if (anio < 1900 || anio > 2999) return@fecha "debe ser una fecha entre 1900 y 2999"
        if (mes !in 1..12) return@fecha "debe ser una fecha que exista"
        val bisiesto = (anio % 4 == 0 && anio % 100 != 0) || anio % 400 == 0
        val ultimo = DIAS_DEL_MES[mes - 1] + if (mes == 2 && bisiesto) 1 else 0
        if (dia in 1..ultimo) null else "debe ser una fecha que exista"
    }

    /** Forma `Continente/Ciudad`: rechaza `UTC`, `EST` y desfases como `+01:00`. */
    private val FORMA_DE_ZONA = Regex("[A-Z][A-Za-z_]*(?:/[A-Za-z0-9_+-]+)+")

    // como Intl del servidor: el nombre existe en la base de zonas, sin distinguir mayúsculas. La base es la del
    // celular y puede no ser la del servidor: una zona muy nueva puede faltar de un lado (manda el rechazo del servidor)
    private val ZONAS: Set<String> by lazy { java.time.ZoneId.getAvailableZoneIds().mapTo(HashSet()) { it.lowercase() } }

    private val zonaHoraria: Regla = { v ->
        val t = texto(v)
        when {
            t == null || !FORMA_DE_ZONA.matches(t) -> "debe ser una zona horaria IANA con la forma Continente/Ciudad"
            t.lowercase() !in ZONAS -> "debe ser una zona horaria IANA"
            else -> null
        }
    }

    /** Acepta null además de lo que acepte la regla: en una edición, null borra el campo opcional. */
    private fun anulable(regla: Regla): Regla = { v -> if (v is JsonNull) null else regla(v) }

    private val decimales: Regla = entero(0, 4)
    private val simbolo: Regla = texto(8)
    private val nombre: Regla = texto(100)
    private val textoCorto: Regla = texto(200)
    private val nota: Regla = texto(2000, true)
    private val emoji: Regla = texto(32)
    private val apodo: Regla = texto(40)
    private val montoPositivo: Regla = entero(1, Dinero.MAX_MONTO_MINOR)
    private val montoNoNegativo: Regla = entero(0, Dinero.MAX_MONTO_MINOR)

    private val listaDeMonedas: Regla = lista@{ v ->
        if (v !is JsonArray || v.isEmpty() || v.size > 10) return@lista "debe ser una lista de 1 a 10 monedas"
        val vistos = HashSet<String>()
        for (m in v) {
            if (m !is JsonObject) return@lista "cada moneda debe ser un objeto"
            if (m.keys.any { it != "codigo" && it != "decimales" && it != "simbolo" }) return@lista "una moneda trae campos que no corresponden"
            val error = codigoMoneda(m["codigo"] ?: JsonNull) ?: decimales(m["decimales"] ?: JsonNull) ?: simbolo(m["simbolo"] ?: JsonNull)
            if (error != null) return@lista "moneda inválida: $error"
            if (!vistos.add(texto(m["codigo"]!!)!!)) return@lista "hay monedas repetidas"
        }
        null
    }

    // ---- esquemas por tipo de operación -----------------------------------------------------------

    private data class ErrorDeCampo(val campo: String, val motivo: String)

    private class Esquema(
        val entidad: String,
        val id: Regla,
        val campos: Map<String, Regla>,
        /** Campos que deben venir (y, salvo que la regla acepte null, no pueden ser null). */
        val obligatorios: List<String> = emptyList(),
        /** Una edición debe traer al menos un campo. */
        val minimoUno: Boolean = false,
        /** Reglas que miran varios campos a la vez. */
        val cruzada: ((Operacion) -> ErrorDeCampo?)? = null,
    )

    private val fechasEnOrden: (Operacion) -> ErrorDeCampo? = { op ->
        val ini = op.payload["fecha_inicio"]?.let { texto(it) }
        val fin = op.payload["fecha_fin"]?.let { texto(it) }
        if (ini != null && fin != null && fin < ini) ErrorDeCampo("fecha_fin", "no puede ser anterior a fecha_inicio") else null
    }

    private val ubicacionEnPareja: (Operacion) -> ErrorDeCampo? = { op ->
        val p = op.payload
        val tieneLat = "lat" in p
        val tieneLon = "lon" in p
        when {
            tieneLat != tieneLon -> ErrorDeCampo("lat", "lat y lon deben venir juntos")
            tieneLat && (p["lat"] is JsonNull) != (p["lon"] is JsonNull) -> ErrorDeCampo("lat", "lat y lon deben ser ambos números o ambos null")
            else -> null
        }
    }

    private val CAMPOS_GASTO = mapOf(
        "monto_minor" to montoPositivo,
        "moneda" to codigoMoneda,
        "categoria_id" to uuidOOtro,
        "cuando_ocurrio" to momento,
        "dia_imputado" to fecha,
        "concepto" to anulable(textoCorto),
        "lugar" to anulable(textoCorto),
        "metodo_pago" to anulable(metodoPago),
        "alias_tarjeta" to anulable(textoCorto),
        "nota" to anulable(nota),
    )

    private val CAMPOS_UBICACION = mapOf(
        "lat" to anulable(numeroEntre(-90.0, 90.0)),
        "lon" to anulable(numeroEntre(-180.0, 180.0)),
        "precision_m" to anulable(numeroEntre(0.0, 100000.0)),
        "ubicacion_tomada_en" to anulable(momento),
    )

    private val CAMPOS_FIJO = mapOf(
        "nombre" to nombre,
        "moneda" to codigoMoneda,
        "monto_unitario_minor" to montoNoNegativo,
        "cantidad" to entero(1, 100000),
        "unidad" to anulable(textoCorto),
        "metodo_pago" to anulable(metodoPago),
        "alias_tarjeta" to anulable(textoCorto),
        "lugar" to anulable(textoCorto),
        "enlace_mapa" to anulable(enlace),
        "nota" to anulable(nota),
        "lat" to CAMPOS_UBICACION.getValue("lat"),
        "lon" to CAMPOS_UBICACION.getValue("lon"),
    )

    private val CAMPOS_ATAJO = mapOf(
        "nombre" to nombre,
        "monto_minor" to montoPositivo,
        "moneda" to codigoMoneda,
        "categoria_id" to uuidOOtro,
        "metodo_pago" to anulable(metodoPago),
        "alias_tarjeta" to anulable(textoCorto),
        "lugar" to anulable(textoCorto),
        "orden" to entero(0, 1000000),
    )

    private val CAMPOS_EFECTIVO = mapOf(
        "cuando" to momento,
        "nota" to anulable(nota),
        "moneda_sale" to codigoMoneda,
        "monto_sale_minor" to montoPositivo,
        "moneda_entra" to codigoMoneda,
        "monto_entra_minor" to montoPositivo,
        "moneda_ajuste" to codigoMoneda,
        "saldo_ajuste_minor" to montoNoNegativo,
    )

    /** Campos de dinero que lleva cada tipo de movimiento de efectivo. */
    val DINERO_DEL_MOVIMIENTO: Map<String, List<String>> = mapOf(
        "CAMBIO" to listOf("moneda_sale", "monto_sale_minor", "moneda_entra", "monto_entra_minor"),
        "RETIRO" to listOf("moneda_entra", "monto_entra_minor"),
        "AJUSTE" to listOf("moneda_ajuste", "saldo_ajuste_minor"),
    )

    private val movimientoCoherente: (Operacion) -> ErrorDeCampo? = mov@{ op ->
        val p = op.payload
        val tipo = p["tipo"]?.let { texto(it) }
        val esperados = DINERO_DEL_MOVIMIENTO[tipo].orEmpty()
        val presentes = p.keys.filter { it != "tipo" && it != "cuando" && it != "nota" }
        if (presentes.size != esperados.size || presentes.any { it !in esperados }) {
            return@mov ErrorDeCampo("tipo", "un movimiento $tipo lleva exactamente ${esperados.joinToString(", ")}")
        }
        if (tipo == "CAMBIO" && p["moneda_sale"] == p["moneda_entra"]) ErrorDeCampo("moneda_entra", "un cambio necesita dos monedas distintas") else null
    }

    private val adjuntoCoherente: (Operacion) -> ErrorDeCampo? = { op ->
        val mime = op.payload["mime"]?.let { texto(it) }
        val tope = if (mime == "application/pdf") MAX_BYTES_PDF else MAX_BYTES_IMAGEN
        val bytes = op.payload["bytes"]?.let { numero(it) }
        if (bytes != null && bytes > tope) ErrorDeCampo("bytes", "un $mime no puede pasar de $tope bytes") else null
    }

    // el producto no entra en un Long: se compara dividiendo (unitario * cantidad > MAX ⇔ unitario > MAX / cantidad)
    private val totalDelFijo: (Operacion) -> ErrorDeCampo? = { op ->
        val unitario = op.payload["monto_unitario_minor"]?.let { enteroSeguro(it) }
        val cantidad = op.payload["cantidad"]?.let { enteroSeguro(it) }
        if (unitario != null && cantidad != null && cantidad > 0 && unitario > Dinero.MAX_MONTO_MINOR / cantidad) {
            ErrorDeCampo("cantidad", "el total (monto por unidad por cantidad) es demasiado grande")
        } else {
            ubicacionEnPareja(op)
        }
    }

    private val noArchivarOtro: (Operacion) -> ErrorDeCampo? = { op ->
        if (op.entidadId == "otro" && op.payload["archivada"]?.let { enteroSeguro(it) } == 1L) ErrorDeCampo("archivada", "la categoría Otro no se archiva") else null
    }

    private fun vacio(entidad: String, id: Regla) = Esquema(entidad, id, emptyMap())

    private val camposViaje = mapOf("nombre" to nombre, "zona_horaria" to zonaHoraria, "fecha_inicio" to anulable(fecha), "fecha_fin" to anulable(fecha))

    private val ESQUEMAS: Map<String, Esquema> = mapOf(
        "trip.create" to Esquema("trip", uuid, camposViaje + ("monedas" to listaDeMonedas), listOf("nombre", "zona_horaria", "monedas"), cruzada = fechasEnOrden),
        "trip.update" to Esquema(
            "trip", uuid,
            camposViaje + mapOf("objetivos" to anulable(nota), "estado_manual" to anulable(enumerado("EN_CURSO", "CERRADO"))),
            minimoUno = true, cruzada = fechasEnOrden,
        ),
        "currency.enable" to Esquema("trip_currency", codigoMoneda, mapOf("habilitada" to exacto(1), "decimales" to decimales, "simbolo" to simbolo), listOf("habilitada", "decimales", "simbolo")),
        "currency.disable" to Esquema("trip_currency", codigoMoneda, mapOf("habilitada" to exacto(0)), listOf("habilitada")),
        "currency.update" to Esquema("trip_currency", codigoMoneda, mapOf("tope_minor" to anulable(montoNoNegativo), "efectivo_inicial_minor" to anulable(montoNoNegativo)), minimoUno = true),
        "member.join" to Esquema("member", uuid, mapOf("apodo" to apodo, "color" to color, "emoji" to emoji, "es_organizador" to binario), listOf("apodo", "color", "emoji", "es_organizador")),
        "member.update" to Esquema("member", uuid, mapOf("apodo" to apodo, "color" to color, "emoji" to emoji), minimoUno = true),
        "category.create" to Esquema("category", uuidOOtro, mapOf("nombre" to nombre, "color" to color, "emoji" to emoji), listOf("nombre", "color", "emoji")),
        "category.update" to Esquema("category", uuidOOtro, mapOf("nombre" to nombre, "color" to color, "emoji" to emoji), minimoUno = true),
        "category.archive" to Esquema("category", uuidOOtro, mapOf("archivada" to binario), listOf("archivada"), cruzada = noArchivarOtro),
        "expense.create" to Esquema("expense", uuid, CAMPOS_GASTO, listOf("monto_minor", "moneda", "categoria_id", "cuando_ocurrio", "dia_imputado")),
        "expense.update" to Esquema("expense", uuid, CAMPOS_GASTO + CAMPOS_UBICACION, minimoUno = true, cruzada = ubicacionEnPareja),
        "expense.delete" to Esquema("expense", uuid, mapOf("eliminado" to exacto(1)), listOf("eliminado")),
        "expense.restore" to Esquema("expense", uuid, mapOf("eliminado" to exacto(0)), listOf("eliminado")),
        "expense.purge" to vacio("expense", uuid),
        "fixed.create" to Esquema("fixed_cost", uuid, CAMPOS_FIJO, listOf("nombre", "moneda", "monto_unitario_minor", "cantidad"), cruzada = totalDelFijo),
        "fixed.update" to Esquema("fixed_cost", uuid, CAMPOS_FIJO + ("pagado_en" to anulable(momento)), minimoUno = true, cruzada = totalDelFijo),
        "fixed.delete" to vacio("fixed_cost", uuid),
        "attachment.add" to Esquema(
            "attachment", uuid,
            mapOf(
                "owner_tipo" to enumerado("EXPENSE", "FIXED_COST"),
                "owner_id" to uuid,
                "mime" to enumerado("image/jpeg", "image/png", "image/webp", "application/pdf"),
                "bytes" to entero(1, MAX_BYTES_PDF),
                "sha256" to sha256,
                "tiene_miniatura" to binario,
            ),
            listOf("owner_tipo", "owner_id", "mime", "bytes", "sha256", "tiene_miniatura"),
            cruzada = adjuntoCoherente,
        ),
        "attachment.remove" to Esquema("attachment", uuid, mapOf("quitado" to exacto(1)), listOf("quitado")),
        "shortcut.create" to Esquema("shortcut", uuid, CAMPOS_ATAJO, listOf("nombre", "monto_minor", "moneda", "categoria_id", "orden")),
        "shortcut.update" to Esquema("shortcut", uuid, CAMPOS_ATAJO, minimoUno = true),
        "shortcut.delete" to vacio("shortcut", uuid),
        "cashmove.create" to Esquema("cash_movement", uuid, mapOf("tipo" to enumerado("CAMBIO", "RETIRO", "AJUSTE")) + CAMPOS_EFECTIVO, listOf("tipo", "cuando"), cruzada = movimientoCoherente),
        "cashmove.update" to Esquema("cash_movement", uuid, CAMPOS_EFECTIVO, minimoUno = true),
        "cashmove.delete" to vacio("cash_movement", uuid),
    )

    /** Los tipos de operación que existen. */
    val TIPOS: Set<String> get() = ESQUEMAS.keys

    // ---- validación -------------------------------------------------------------------------------

    /** Valida el formato de una operación (sin mirar el estado). */
    fun validar(op: Operacion): ResultadoValidacion {
        val esquema = ESQUEMAS[op.tipo] ?: return ResultadoValidacion.Rechazada("tipo", "tipo de operación desconocido")
        if (op.entidadTipo != esquema.entidad) return ResultadoValidacion.Rechazada("entidadTipo", "una operación ${op.tipo} es de ${esquema.entidad}")
        if (uuid(JsonPrimitive(op.opId)) != null) return ResultadoValidacion.Rechazada("opId", "debe ser un UUID en minúsculas")
        esquema.id(JsonPrimitive(op.entidadId))?.let { return ResultadoValidacion.Rechazada("entidadId", it) }
        if (Reloj.parsear(op.hlc) == null) return ResultadoValidacion.Rechazada("hlc", "debe ser una marca válida")
        if (op.schemaVersion !in VERSIONES_DE_FORMATO) return ResultadoValidacion.Rechazada("schemaVersion", "versión de formato que esta app no entiende")

        val payload = op.payload
        payload.keys.firstOrNull { it !in esquema.campos }?.let { return ResultadoValidacion.Rechazada(it.take(64), "campo que no corresponde a esta operación") }
        esquema.obligatorios.firstOrNull { it !in payload }?.let { return ResultadoValidacion.Rechazada(it, "campo obligatorio") }
        for ((clave, regla) in esquema.campos) {
            val valor = payload[clave] ?: continue
            regla(valor)?.let { return ResultadoValidacion.Rechazada(clave, it) }
        }
        if (esquema.minimoUno && payload.isEmpty()) return ResultadoValidacion.Rechazada("payload", "una edición debe traer al menos un campo")
        return esquema.cruzada?.invoke(op)?.let { ResultadoValidacion.Rechazada(it.campo, it.motivo) } ?: ResultadoValidacion.Ok
    }
}
