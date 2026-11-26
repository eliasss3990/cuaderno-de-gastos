// Paso 2 del nuevo viaje: el tope por moneda (con el promedio diario que sugiere), el efectivo inicial y los objetivos.
package com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.partes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.AccionesDeNuevoViaje
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.MonedaElegible
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.NuevoViajeEstado
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.CampoDeTexto
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.Tarjeta
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

private val tamanoDelPromedio = 22.sp

@Composable
fun PasoTope(estado: NuevoViajeEstado, acciones: AccionesDeNuevoViaje) {
    val elegidas = estado.monedas.filter { it.elegida }
    Tarjeta(titulo = stringResource(R.string.nuevo_tope_titulo)) {
        Text(stringResource(R.string.nuevo_tope_incluye) + " " + stringResource(R.string.nuevo_opcional), style = Tema.texto.cuerpo.copy(fontSize = 14.sp), color = Tema.colores.apagado, modifier = Modifier.padding(bottom = Tema.espacios.s))
        Montos(elegidas, estado.topes, acciones.alCambiarTope)
    }
    if (estado.promedios.isNotEmpty()) {
        Tarjeta(titulo = stringResource(R.string.nuevo_promedio_titulo, estado.dias ?: 0), fondo = Tema.colores.principalSuave, borde = Tema.colores.principal, colorDelTitulo = Tema.colores.tintaDelAviso) {
            estado.promedios.forEachIndexed { i, p ->
                Text(p.monto, style = Tema.texto.grande.copy(fontSize = tamanoDelPromedio), color = Tema.colores.tintaDelAviso, modifier = if (i > 0) Modifier.padding(top = Tema.espacios.s) else Modifier)
                Text(p.cuenta, style = Tema.texto.chico, color = Tema.colores.etiqueta)
            }
        }
    }
    Tarjeta(titulo = stringResource(R.string.nuevo_efectivo_titulo)) {
        Montos(elegidas, estado.efectivo, acciones.alCambiarEfectivo)
    }
    CampoDeTexto(stringResource(R.string.nuevo_objetivos), estado.objetivos, acciones.alCambiarObjetivos, unaLinea = false, lineasMinimas = 3)
}

/** Un campo por moneda, rotulado con su nombre y con el símbolo delante; sin decimales, el teclado es solo de números. */
@Composable
private fun Montos(monedas: List<MonedaElegible>, valores: Map<String, String>, alCambiar: (String, String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
        for (m in monedas) {
            CampoDeTexto(
                m.nombre, valores[m.moneda.codigo].orEmpty(), { alCambiar(m.moneda.codigo, it) }, Modifier.weight(1f),
                teclado = if (m.moneda.decimales == 0) KeyboardType.Number else KeyboardType.Decimal,
                prefijo = { Text("${m.moneda.simbolo} ", style = Tema.texto.valorDeCampo, color = Tema.colores.apagado) },
                accion = ImeAction.Next,
            )
        }
    }
}
