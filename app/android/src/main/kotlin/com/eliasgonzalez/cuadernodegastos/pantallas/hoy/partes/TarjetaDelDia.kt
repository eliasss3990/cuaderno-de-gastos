// La tarjeta de arriba de Hoy: la fecha, el día del viaje, lo gastado por moneda y las barras de lo previsto.
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy.partes

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Nivel
import androidx.compose.ui.platform.LocalDensity
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.HoyEstado
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.TotalEnPantalla
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraDeProgreso
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.Tarjeta
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.colorDeLaEscala

@Composable
fun TarjetaDelDia(estado: HoyEstado) {
    Tarjeta(relleno = Tema.espacios.l) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(estado.fecha, style = Tema.texto.rotulo, color = Tema.colores.apagado, modifier = Modifier.weight(1f))
            estado.dia?.let { Text(it, style = Tema.texto.chico, color = Tema.colores.apagado) }
        }
        // con letra grande los totales van uno debajo del otro; el símbolo nunca se separa del número
        val apilado = LocalDensity.current.fontScale >= 1.3f
        val total = @Composable { t: TotalEnPantalla, m: Modifier, alineado: Alignment.Horizontal ->
            Column(m, horizontalAlignment = alineado) {
                Text(t.nombre, style = Tema.texto.chico, color = Tema.colores.apagado)
                Text(t.monto.replace(' ', '\u00A0'), style = Tema.texto.grande, color = Tema.colores.tinta)
            }
        }
        if (apilado) {
            Column(Modifier.fillMaxWidth().padding(top = Tema.espacios.s)) { estado.totales.forEach { total(it, Modifier, Alignment.Start) } }
        } else {
            Row(Modifier.fillMaxWidth().padding(top = Tema.espacios.s)) {
                estado.totales.forEachIndexed { i, t -> total(t, Modifier.weight(1f), if (i == 0) Alignment.Start else Alignment.End) }
            }
        }
        for (t in estado.totales) {
            val previsto = t.previsto ?: continue
            val nivel = t.nivel ?: Nivel.BIEN
            val porcentaje = t.porcentaje ?: 0
            Spacer(Modifier.height(6.dp))
            val usaste = @Composable {
                // el porcentaje toma el color de la barra solo cuando hay que mirarlo (desde el 80 %)
                Text(
                    "usaste $porcentaje %",
                    style = Tema.texto.chico.copy(fontWeight = FontWeight.Bold),
                    color = if (nivel == Nivel.BIEN) Tema.colores.apagado else colorDeLaEscala(nivel, porcentaje),
                )
            }
            // "Para hoy: ₲ 290.000" no se parte; con letra grande el porcentaje va debajo
            val linea = previsto.replace(' ', '\u00A0')
            if (apilado) {
                Text(linea, style = Tema.texto.chico, color = Tema.colores.apagado)
                usaste()
            } else {
                Row {
                    Text(linea, style = Tema.texto.chico, color = Tema.colores.apagado, modifier = Modifier.weight(1f))
                    usaste()
                }
            }
            BarraDeProgreso(porcentaje / 100f, colorDeLaEscala(nivel, porcentaje))
        }
    }
}
