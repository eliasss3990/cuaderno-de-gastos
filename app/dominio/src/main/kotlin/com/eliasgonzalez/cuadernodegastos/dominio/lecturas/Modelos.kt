// Lo que las pantallas leen del viaje, ya con sus tipos (el almacén guarda cada entidad como campos JSON sueltos).
package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda

data class Viaje(
    val id: String,
    val nombre: String,
    val zonaHoraria: String,
    val fechaInicio: String?,
    val fechaFin: String?,
    val objetivos: String?,
    /** Solo EN_CURSO o CERRADO si alguien lo fijó a mano; si no, manda lo que digan las fechas. */
    val estadoManual: EstadoViaje?,
)

/** Una moneda del viaje con lo que el plan le fija. */
data class MonedaDelPlan(
    val moneda: Moneda,
    val habilitada: Boolean,
    val topeMinor: Long?,
    val efectivoInicialMinor: Long?,
)

data class Integrante(val id: String, val apodo: String, val color: String, val emoji: String, val esOrganizador: Boolean)

data class Categoria(val id: String, val nombre: String, val color: String, val emoji: String, val archivada: Boolean)

data class Gasto(
    val id: String,
    val montoMinor: Long,
    val moneda: String,
    val categoriaId: String,
    /** Cuándo pasó (ms epoch UTC). */
    val cuandoOcurrio: Long,
    /** El día al que cuenta (AAAA-MM-DD, en la zona del viaje). */
    val diaImputado: String,
    val concepto: String?,
    val lugar: String?,
    val metodoPago: String?,
    val aliasTarjeta: String?,
    val nota: String?,
    /** En la papelera (borrado, todavía se puede restaurar). */
    val eliminado: Boolean,
    /** El integrante que lo cargó, o null si no se sabe. */
    val autor: String?,
    /** Tiene cambios propios que el servidor todavía no confirmó. */
    val sinConfirmar: Boolean,
    /** Tiene un cambio propio que el servidor rechazó: lo que se ve acá puede no coincidir con los demás. */
    val enCuarentena: Boolean = false,
)

data class GastoFijo(
    val id: String,
    val nombre: String,
    val moneda: String,
    val montoUnitarioMinor: Long,
    val cantidad: Long,
    val metodoPago: String?,
    /** Cuándo se marcó pagado (ms epoch UTC); null si está pendiente. */
    val pagadoEn: Long?,
) {
    /** No desborda: la validación rechaza un fijo cuyo total no entra. */
    val totalMinor: Long get() = montoUnitarioMinor * cantidad
}
