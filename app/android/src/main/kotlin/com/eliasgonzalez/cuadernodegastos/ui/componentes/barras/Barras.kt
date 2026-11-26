// Las barras de arriba y de abajo, y la barra de progreso.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.barras

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.eliasgonzalez.cuadernodegastos.R
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

/** El botón de la izquierda de la barra de arriba. */
enum class IconoDeBarra { CERRAR, VOLVER }

/** La barra de arriba: un botón opcional (cerrar o volver, de 48), el título y lo que vaya a la derecha. */
@Composable
fun BarraSuperior(
    titulo: String,
    icono: IconoDeBarra? = null,
    alTocarIcono: () -> Unit = {},
    /** Si el título se toca (por ejemplo, para cambiar de viaje): muestra ▾ y lo anuncia como botón. */
    alTocarTitulo: (() -> Unit)? = null,
    descripcionDelTitulo: String? = null,
    derecha: @Composable RowScope.() -> Unit = {},
) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(start = if (icono != null) Tema.espacios.xs else Tema.espacios.l, end = Tema.espacios.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s + Tema.espacios.xs / 2),
    ) {
        if (icono != null) {
            val (imagen, descripcion) = when (icono) {
                IconoDeBarra.CERRAR -> Icons.Filled.Close to stringResource(R.string.cerrar)
                IconoDeBarra.VOLVER -> Icons.AutoMirrored.Filled.ArrowBack to stringResource(R.string.volver)
            }
            IconButton(onClick = alTocarIcono, modifier = Modifier.size(48.dp)) {
                Icon(imagen, contentDescription = descripcion, tint = Tema.colores.tinta)
            }
        }
        if (alTocarTitulo == null) {
            Text(titulo, style = Tema.texto.tituloDeBarra, color = Tema.colores.tinta, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Row(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button, onClickLabel = descripcionDelTitulo, onClick = alTocarTitulo)
                    .semantics { heading() },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(titulo, style = Tema.texto.tituloDeBarra, color = Tema.colores.tinta, modifier = Modifier.weight(1f, fill = false))
                Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = Tema.colores.tinta)
            }
        }
        derecha()
    }
}

/** Una pestaña de la barra de abajo. */
data class Pestana(val icono: String, val texto: String, val activa: Boolean, val alTocar: () -> Unit)

@Composable
fun BarraInferior(pestanas: List<Pestana>) {
    Row(
        // alto mínimo (con letra grande crece); las pestañas se anuncian como tales
        Modifier.fillMaxWidth().heightIn(min = 68.dp).height(IntrinsicSize.Min).background(Tema.colores.superficie).border(1.dp, Tema.colores.linea).selectableGroup(),
    ) {
        for (p in pestanas) {
            Column(
                Modifier.weight(1f).fillMaxHeight().selectable(selected = p.activa, role = Role.Tab, onClick = p.alTocar).padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                val fondo = if (p.activa) Modifier.background(Tema.colores.principalSuave, RoundedCornerShape(14.dp)) else Modifier
                // el emoji no crece con la letra y el lector lo salta (lee el nombre de la pestaña)
                Text(p.icono, fontSize = with(LocalDensity.current) { 22.dp.toSp() }, modifier = fondo.padding(horizontal = 18.dp, vertical = 2.dp).clearAndSetSemantics {})
                Text(
                    p.texto,
                    style = Tema.texto.navegacion.copy(fontWeight = if (p.activa) FontWeight.Bold else FontWeight.Normal),
                    color = if (p.activa) Tema.colores.principal else Tema.colores.apagado,
                    // crece con la letra hasta 1,3 veces: más grande no entran 4 pestañas en el ancho
                    fontSize = with(LocalDensity.current) { (12f * minOf(fontScale, 1.3f)).dp.toSp() },
                    maxLines = 1,
                )
            }
        }
    }
}

/** Una barra de progreso de 8 de alto; `fraccion` entre 0 y 1. */
@Composable
fun BarraDeProgreso(fraccion: Float, color: Color, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(Tema.colores.pista)) {
        Box(Modifier.fillMaxWidth(fraccion.coerceIn(0f, 1f)).fillMaxHeight().clip(RoundedCornerShape(4.dp)).background(color))
    }
}
