// La tarjeta y el aviso informativo.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas

import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.foundation.layout.heightIn
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

/**
 * Un aviso breve de que algo salió bien (por ejemplo, un gasto guardado), con una acción opcional (deshacer). Se anuncia
 * al aparecer; quien lo muestra decide cuánto dura.
 */
@Composable
fun AvisoBreve(texto: String, modifier: Modifier = Modifier, accion: String? = null, alTocarAccion: () -> Unit = {}, salioMal: Boolean = false) {
    // salió mal: en el tono de error y con otro ícono (no se confunde con un aviso de que salió bien)
    val fondo = if (salioMal) Tema.colores.errorSuave else Tema.colores.bienSuave
    val tono = if (salioMal) Tema.colores.error else Tema.colores.bien
    Row(
        modifier
            .fillMaxWidth()
            .background(fondo, Tema.formas.campo)
            .border(1.dp, tono, Tema.formas.campo)
            .padding(start = Tema.espacios.m, end = Tema.espacios.xs)
            .heightIn(min = 52.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (salioMal) Icons.Filled.Warning else Icons.Filled.CheckCircle, contentDescription = null, tint = tono)
        Text(texto, style = Tema.texto.fuerte, color = Tema.colores.tinta, modifier = Modifier.weight(1f).padding(horizontal = Tema.espacios.s))
        if (accion != null) {
            TextButton(onClick = alTocarAccion, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(accion, style = Tema.texto.fuerte, color = Tema.colores.principal)
            }
        }
    }
}
