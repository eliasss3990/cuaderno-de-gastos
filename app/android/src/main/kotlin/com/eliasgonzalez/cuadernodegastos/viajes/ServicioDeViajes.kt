// Crear un viaje (con su plan) y unirse a uno: lo que hacen las pantallas de bienvenida, nuevo viaje y unirse. Pide la
// conexión una sola vez: después del alta, baja el viaje y guarda el plan como operaciones propias (se suben solas).
package com.eliasgonzalez.cuadernodegastos.viajes

import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.Ids
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado as ResultadoDelMotor
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.red.Credenciales
import com.eliasgonzalez.cuadernodegastos.red.MonedaNueva
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.red.Resultado
import com.eliasgonzalez.cuadernodegastos.red.ViajeNuevo
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Lo que se carga en el plan de un viaje nuevo (pantallas de nuevo viaje, pasos 1 y 2). */
data class PlanNuevo(
    val nombre: String,
    val zonaHoraria: String,
    val monedas: List<MonedaNueva>,
    val fechaInicio: String? = null,
    val fechaFin: String? = null,
    /** Por código de moneda; las que no están (o son null) quedan sin tope. */
    val topes: Map<String, Long?> = emptyMap(),
    val efectivoInicial: Map<String, Long?> = emptyMap(),
    val objetivos: String? = null,
) {
    private fun zonaValida(z: String) = try {
        EstadoDelViaje.diaEn(0, z)
        true
    } catch (_: IllegalArgumentException) {
        false
    }

    // AAAA-MM-DD de un día que existe (se comparan como texto: tienen que venir así)
    private fun fechaValida(f: String) = Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(f) && try {
        java.time.LocalDate.parse(f)
        true
    } catch (_: java.time.DateTimeException) {
        false
    }

    /** El primer problema del plan, para la pantalla (el campo y qué pasa), o null si está bien. */
    fun problema(): Pair<String, String>? {
        val codigos = monedas.map { it.codigo }
        return when {
            nombre.isBlank() -> "nombre" to "el viaje necesita un nombre"
            !zonaValida(zonaHoraria) -> "zona_horaria" to "la zona horaria no existe"
            listOfNotNull(fechaInicio, fechaFin).any { !fechaValida(it) } -> "fechas" to "una fecha no es válida"
            monedas.isEmpty() -> "monedas" to "el viaje necesita al menos una moneda"
            codigos.toSet().size != codigos.size -> "monedas" to "hay una moneda repetida"
            fechaInicio != null && fechaFin != null && fechaFin < fechaInicio -> "fecha_fin" to "termina antes de empezar"
            (topes.keys + efectivoInicial.keys).any { it !in codigos } -> "monedas" to "hay un monto de una moneda que no es del viaje"
            (topes.values + efectivoInicial.values).any { it != null && it < 0 } -> "montos" to "un monto no puede ser negativo"
            else -> null
        }
    }
}

/** Cómo terminó crear o unirse. */
sealed interface AltaDeViaje {
    /**
     * Listo: el viaje está en el celular (y su plan, si se cargó). `alDia` es false si al unirse no se pudo bajar todavía
     * (llega con la próxima sincronización: la pantalla lo dice).
     */
    data class Lista(val viaje: String, val alDia: Boolean = true) : AltaDeViaje

    /**
     * El viaje quedó creado y vinculado, pero no se pudo bajar para guardar el plan (se cortó la conexión justo después):
     * el nombre, las fechas y las monedas ya están; el tope, el efectivo y los objetivos se vuelven a intentar con
     * `guardarPlan` (la pantalla lo ofrece con lo cargado, que viaja acá).
     */
    data class SinPlan(val viaje: String, val plan: PlanNuevo) : AltaDeViaje

    /** El plan tiene un problema: no se pidió nada al servidor. */
    data class PlanInvalido(val campo: String, val mensaje: String) : AltaDeViaje

    /** El código era de un viaje que ya está en este celular. */
    data class YaEstaba(val viaje: String) : AltaDeViaje

    /**
     * No se pudo; `motivo` dice por qué (para el mensaje de la pantalla). Con `Resultado.Incierto` el viaje (o el ingreso)
     * pudo haber quedado hecho: la pantalla no ofrece reintentar a ciegas.
     */
    data class Fallo(val motivo: Resultado<Nothing>) : AltaDeViaje
}

/** Lo que el servicio necesita de la app (en la app: el cliente de identidad y la sincronización). */
interface PuertosDeViajes {
    fun crear(viaje: ViajeNuevo, quien: Perfil): Resultado<Credenciales>

    fun unirse(codigo: String, quien: Perfil): Resultado<Credenciales>

    fun vincular(c: Credenciales)

    /** El viaje ya está vinculado en este celular. */
    fun vinculado(viaje: String): Boolean

    fun sincronizar(viaje: String): FinDelCiclo

    fun registrar(viaje: String, op: (Sincronizador) -> Operacion): ResultadoDelMotor
}

class ServicioDeViajes(
    private val puertos: PuertosDeViajes,
    private val ahora: () -> Long = System::currentTimeMillis,
    /** Cómo se espera entre intentos de bajar (en las pruebas, sin esperar de verdad). */
    private val esperar: (Long) -> Unit = { Thread.sleep(it) },
) {
    companion object {
        /** Cuántas veces se intenta bajar el viaje recién creado antes de seguir sin el plan. */
        const val INTENTOS_DE_BAJAR = 3

        /** La espera más larga entre intentos: la persona está mirando la pantalla. */
        const val ESPERA_MAXIMA_MS = 3_000L
    }

    /** Bloquea (red y base): llamar fuera del hilo principal. */
    fun crear(plan: PlanNuevo, quien: Perfil): AltaDeViaje {
        plan.problema()?.let { (campo, mensaje) -> return AltaDeViaje.PlanInvalido(campo, mensaje) }
        val alta = puertos.crear(ViajeNuevo(plan.nombre, plan.zonaHoraria, plan.monedas, plan.fechaInicio, plan.fechaFin), quien)
        val c = (alta as? Resultado.Ok)?.valor ?: return AltaDeViaje.Fallo(falla(alta))
        puertos.vincular(c)
        return guardarPlan(c.viaje, plan)
    }

    /** Guarda el tope, el efectivo y los objetivos de un viaje ya vinculado (también para reintentar tras SinPlan). */
    fun guardarPlan(viaje: String, plan: PlanNuevo): AltaDeViaje {
        plan.problema()?.let { (campo, mensaje) -> return AltaDeViaje.PlanInvalido(campo, mensaje) }
        // el plan se guarda sobre el viaje bajado: sin él, las monedas todavía no existen en el celular
        if (!bajar(viaje)) return AltaDeViaje.SinPlan(viaje, plan)
        for (m in plan.monedas) {
            val campos = buildMap {
                plan.topes[m.codigo]?.let { put("tope_minor", JsonPrimitive(it)) }
                plan.efectivoInicial[m.codigo]?.let { put("efectivo_inicial_minor", JsonPrimitive(it)) }
            }
            if (campos.isNotEmpty()) registrar(viaje, "currency.update", "trip_currency", m.codigo, campos)
        }
        plan.objetivos?.takeIf { it.isNotBlank() }?.let { registrar(viaje, "trip.update", "trip", viaje, mapOf("objetivos" to JsonPrimitive(it))) }
        // lo guardado se sube solo (el registro avisa a la sincronización)
        return AltaDeViaje.Lista(viaje)
    }

    /** Bloquea (red y base): llamar fuera del hilo principal. */
    fun unirse(codigo: String, quien: Perfil): AltaDeViaje {
        val alta = puertos.unirse(codigo.trim().uppercase(), quien)
        val c = (alta as? Resultado.Ok)?.valor ?: return AltaDeViaje.Fallo(falla(alta))
        // el servidor no sabe que este celular ya lo tiene: el ingreso nuevo se ignora (queda como un celular sin usar)
        if (puertos.vinculado(c.viaje)) return AltaDeViaje.YaEstaba(c.viaje)
        puertos.vincular(c)
        // si no se puede bajar ahora, el viaje llega con la próxima sincronización
        return AltaDeViaje.Lista(c.viaje, alDia = bajar(c.viaje))
    }

    private fun bajar(viaje: String): Boolean {
        repeat(INTENTOS_DE_BAJAR) { intento ->
            when (val fin = puertos.sincronizar(viaje)) {
                FinDelCiclo.AlDia -> return true
                // lo que pide el ciclo, sin pasar el tope; después del último intento no se espera
                is FinDelCiclo.Reintentar -> if (intento < INTENTOS_DE_BAJAR - 1) esperar(minOf(fin.enMs, ESPERA_MAXIMA_MS))
                // revocado, app vieja o un rechazo: reintentar no lo arregla
                else -> return false
            }
        }
        return false
    }

    private fun registrar(viaje: String, tipo: String, entidad: String, id: String, campos: Map<String, JsonElement>) {
        val r = puertos.registrar(viaje) { sinc -> Operacion(Ids.nuevo(ahora()), tipo, entidad, id, sinc.nuevaMarca(), JsonObject(campos), 1) }
        // a propósito una excepción y no SinPlan: el plan ya pasó `problema()`, así que un rechazo acá es un error de
        // programación y tiene que verse
        check(r is ResultadoDelMotor.Aceptada) { "el plan no se pudo guardar: $r" }
    }

    private fun falla(r: Resultado<Credenciales>): Resultado<Nothing> = when (r) {
        is Resultado.Ok -> error("no es una falla")
        is Resultado.Rechazado -> r
        Resultado.SinConexion -> Resultado.SinConexion
        Resultado.Incierto -> Resultado.Incierto
        Resultado.AppDesactualizada -> Resultado.AppDesactualizada
    }
}
