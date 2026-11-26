// Una fila de la lista de gastos: ícono de la categoría, qué fue, dónde y cómo, quién y a qué hora, y el monto.
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy.partes

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
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.GastoEnPantalla
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.IconoRedondo
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import com.eliasgonzalez.cuadernodegastos.R

@Composable
fun FilaDeGasto(g: GastoEnPantalla, ultima: Boolean) {
    // el lector de pantalla lee la fila entera de una vez
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tema.espacios.m)) {
        IconoRedondo(g.emoji, colorDe(g.fondo))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(g.titulo, style = Tema.texto.fuerte, color = Tema.colores.tinta)
                // todavía no llegó a los demás: dicho en palabras, no solo con el reloj
                if (g.pendiente) {
                    Row(Modifier.background(Tema.colores.avisoSuave, RoundedCornerShape(10.dp)).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("⏳", style = Tema.texto.etiqueta, modifier = Modifier.padding(end = 4.dp).clearAndSetSemantics {})
                        Text(stringResource(R.string.hoy_sin_enviar), style = Tema.texto.etiqueta, color = Tema.colores.aviso)
                    }
                }
            }
            g.detalle?.let { Text(it, style = Tema.texto.chico, color = Tema.colores.apagado) }
            Text(g.quien, style = Tema.texto.chico, color = Tema.colores.apagado)
        }
        Text(g.monto, style = Tema.texto.monto, color = Tema.colores.tinta)
    }
    if (!ultima) HorizontalDivider(color = Tema.colores.linea)
}
