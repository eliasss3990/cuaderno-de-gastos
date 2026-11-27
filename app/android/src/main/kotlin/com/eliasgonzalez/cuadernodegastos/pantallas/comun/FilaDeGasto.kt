// Una fila de la lista de gastos: ícono de la categoría, qué fue, dónde y cómo, quién y a qué hora, y el monto.
package com.eliasgonzalez.cuadernodegastos.pantallas.comun

import androidx.compose.foundation.layout.Box
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.colorDe
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.IconoRedondo
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import com.eliasgonzalez.cuadernodegastos.R

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FilaDeGasto(g: GastoEnPantalla, ultima: Boolean, alTocar: (() -> Unit)? = null) {
    // el lector de pantalla lee la fila entera de una vez; tocarla abre el detalle
    Row(
        Modifier.fillMaxWidth()
            .let { if (alTocar != null) it.clickable(role = Role.Button, onClickLabel = stringResource(R.string.gastos_ver_detalle), onClick = alTocar) else it }
            .semantics(mergeDescendants = true) {}.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tema.espacios.m)) {
        // con letra grande el monto baja debajo del título (lado a lado no entran) y el ícono queda junto al título
        val apilar = LocalDensity.current.fontScale >= 1.3f
        Box(if (apilar) Modifier.align(Alignment.Top).padding(top = 2.dp) else Modifier) { IconoRedondo(g.emoji, colorDe(g.fondo)) }
        Column(Modifier.weight(1f)) {
            Text(g.titulo, style = Tema.texto.fuerte, color = Tema.colores.tinta, maxLines = 2, overflow = TextOverflow.Ellipsis)
            g.detalle?.let { Text(it, style = Tema.texto.chico.copy(fontSize = 13.sp), color = Tema.colores.apagado, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            // quién y "sin enviar" bajan de renglón enteros si no entran (nunca se parten)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(g.quien, style = Tema.texto.chico.copy(fontSize = 13.sp), color = Tema.colores.apagado)
                // todavía no llegó a los demás: dicho en palabras, no solo con el reloj
                if (g.pendiente) {
                    Row(Modifier.background(Tema.colores.avisoSuave, RoundedCornerShape(10.dp)).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("⏳", style = Tema.texto.etiqueta, modifier = Modifier.padding(end = 4.dp).clearAndSetSemantics {})
                        Text(stringResource(R.string.hoy_sin_enviar), style = Tema.texto.etiqueta, color = Tema.colores.aviso, softWrap = false)
                    }
                }
            }
            if (apilar) Text(g.monto, style = Tema.texto.monto, color = Tema.colores.tinta, softWrap = false)
        }
        if (!apilar) Text(g.monto, style = Tema.texto.monto, color = Tema.colores.tinta, softWrap = false)
    }
    if (!ultima) HorizontalDivider(color = Tema.colores.linea)
}

data class GastoEnPantalla(
    val id: String,
    val emoji: String,
    val fondo: String,
    val titulo: String,
    val detalle: String?,
    val quien: String,
    val monto: String,
    val codigo: String,
    val pendiente: Boolean,
)
