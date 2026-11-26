// La tarjeta y el aviso informativo.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

@Composable
fun Tarjeta(
    modifier: Modifier = Modifier,
    titulo: String? = null,
    fondo: Color = Tema.colores.superficie,
    borde: Color = Tema.colores.linea,
    relleno: Dp = Tema.espacios.m + Tema.espacios.xs / 2,
    colorDelTitulo: Color = Tema.colores.dato,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(fondo, Tema.formas.tarjeta)
            .border(BorderStroke(Tema.medidas.bordeDeTarjeta, borde), Tema.formas.tarjeta)
            .padding(relleno),
    ) {
        if (titulo != null) Text(titulo, style = Tema.texto.tituloDeTarjeta, color = colorDelTitulo, modifier = Modifier.padding(bottom = Tema.espacios.s))
        contenido()
    }
}

/** Un aviso con su ícono a la izquierda (el informativo es celeste). */
@Composable
fun Aviso(icono: String?, texto: @Composable () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().background(Tema.colores.principalSuave, Tema.formas.campo).padding(Tema.espacios.m),
        horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s + Tema.espacios.xs / 2),
    ) {
        // sin emoji: el ícono de información de Material en el color del aviso
        if (icono != null) Text(icono, style = Tema.texto.aviso) else Icon(Icons.Outlined.Info, contentDescription = null, tint = Tema.colores.principal)
        texto()
    }
}
