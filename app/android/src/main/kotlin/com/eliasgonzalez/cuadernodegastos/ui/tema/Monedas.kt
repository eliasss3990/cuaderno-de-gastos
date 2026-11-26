// El color de cada moneda en los montos (guaraníes en rojo, reales en verde; otra, el texto de siempre).
package com.eliasgonzalez.cuadernodegastos.ui.tema

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

@Composable
fun colorDeMoneda(codigo: String): Color = when (codigo) {
    "PYG" -> Tema.colores.guaranies
    "BRL" -> Tema.colores.reales
    else -> Tema.colores.tinta
}
