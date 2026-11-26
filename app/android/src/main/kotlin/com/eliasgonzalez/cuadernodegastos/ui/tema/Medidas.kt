// Espacios, tamaños y formas de la app, en un solo lugar.
package com.eliasgonzalez.cuadernodegastos.ui.tema

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Immutable
data class Espacios(
    val xs: Dp = 4.dp,
    val s: Dp = 8.dp,
    val m: Dp = 12.dp,
    /** El margen a los lados de cada pantalla. */
    val l: Dp = 16.dp,
    val xl: Dp = 24.dp,
)

@Immutable
data class Medidas(
    /** .btn */
    val altoDeBoton: Dp = 52.dp,
    /** El borde del botón secundario. */
    val bordeDeBoton: Dp = 2.dp,
    /** .card */
    val bordeDeTarjeta: Dp = 1.dp,
)

@Immutable
data class Formas(
    val boton: RoundedCornerShape = RoundedCornerShape(26.dp),
    val tarjeta: RoundedCornerShape = RoundedCornerShape(16.dp),
    val campo: RoundedCornerShape = RoundedCornerShape(12.dp),
    val chip: RoundedCornerShape = RoundedCornerShape(16.dp),
)
