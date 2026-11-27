// Lo que dibuja el detalle de un gasto, ya con textos decididos.
package com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto

/** Un dato del gasto: "Quién" → "🦁 Papá". */
data class DatoDelGasto(val etiqueta: String, val valor: String)

data class DetalleEstado(
    val cargando: Boolean = true,
    /** Leer la base falló (se reintenta con el próximo cambio): se dice en vez de quedar en blanco. */
    val noSePudoLeer: Boolean = false,
    /** El gasto ya no existe (lo borraron para siempre en otro celular). */
    val noExiste: Boolean = false,
    val emoji: String = "",
    val fondo: String = "#EEE8D8",
    val monto: String = "",
    /** "Almuerzo en familia · Comida". */
    val subtitulo: String = "",
    val datos: List<DatoDelGasto> = emptyList(),
    /** La nota va aparte (texto largo, alineado a la izquierda). */
    val nota: String? = null,
    val pendiente: Boolean = false,
    /** Está en la papelera: no se edita ni se vuelve a mandar. */
    val enPapelera: Boolean = false,
)
