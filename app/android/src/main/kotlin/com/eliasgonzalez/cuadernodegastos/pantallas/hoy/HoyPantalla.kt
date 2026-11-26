// Hoy: lo gastado en el día contra lo previsto y los últimos gastos de toda la familia (o, sin gastos, el aviso de
// cómo empezar). Las partes viven en `partes/`.
package com.eliasgonzalez.cuadernodegastos.pantallas.hoy

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.partes.FilaDeGasto
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.partes.TarjetaDelDia
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraInferior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraSuperior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.Pestana
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonFlotante
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.IndicadorDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

data class AccionesDeHoy(
    val alCargarGasto: () -> Unit = {},
    /** Cambiar de viaje; null mientras no haya a cuál (el título no se ofrece como tocable). */
    val alElegirViaje: (() -> Unit)? = null,
    val alIrA: (Int) -> Unit = {},
)

private val margenDelVacio = 32.dp

/** Lo que queda libre al final de la lista para que el botón de cargar no tape el último gasto. */
private val espacioBajoLaLista = 96.dp

@Composable
fun HoyPantalla(estado: HoyEstado, acciones: AccionesDeHoy) {
    Column(Modifier.fillMaxSize().background(Tema.colores.fondo).systemBarsPadding()) {
            BarraSuperior(estado.titulo, alTocarTitulo = acciones.alElegirViaje, descripcionDelTitulo = stringResource(R.string.hoy_cambiar_de_viaje)) {
                IndicadorDeSincronizacion(estado.sincronizacion, estado.tono)
            }
            // el botón de cargar flota sobre la lista, justo encima de las pestañas (crezcan o no con la letra)
            Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = Tema.espacios.l)) {
                // la tarjeta del día va siempre: a primera hora es cuando más sirve ver cuánto hay para hoy
                item { Spacer(Modifier.height(Tema.espacios.xs)) }
                item { TarjetaDelDia(estado) }
                if (estado.gastos.isEmpty()) {
                    item {
                        Column(Modifier.fillMaxWidth().padding(top = margenDelVacio, start = 20.dp, end = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("📒", fontSize = 48.sp, modifier = Modifier.clearAndSetSemantics {})
                            Text(stringResource(R.string.hoy_vacio_titulo), style = Tema.texto.grande.copy(fontSize = 22.sp), color = Tema.colores.tinta, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 10.dp))
                            Text(stringResource(R.string.hoy_vacio_texto), style = Tema.texto.cuerpo, color = Tema.colores.apagado, textAlign = TextAlign.Center)
                        }
                    }
                    item { Spacer(Modifier.height(espacioBajoLaLista)) }
                } else {
                    item {
                        Text(
                            stringResource(R.string.hoy_ultimos), style = Tema.texto.rotulo.copy(fontSize = 13.sp), color = Tema.colores.apagado,
                            modifier = Modifier.padding(top = Tema.espacios.m, bottom = Tema.espacios.xs).semantics { heading() },
                        )
                    }
                    itemsIndexed(estado.gastos, key = { _, g -> g.id }) { i, g -> FilaDeGasto(g, ultima = i == estado.gastos.lastIndex) }
                    // que el último gasto no quede tapado por el botón de cargar
                    item { Spacer(Modifier.height(espacioBajoLaLista)) }
                }
            }
            BotonFlotante(stringResource(R.string.hoy_cargar), acciones.alCargarGasto, Modifier.align(Alignment.BottomCenter).padding(bottom = Tema.espacios.l))
            }
            BarraInferior(
                listOf(
                    Pestana("🏠", stringResource(R.string.pestana_hoy), true) { acciones.alIrA(0) },
                    Pestana("📒", stringResource(R.string.pestana_gastos), false) { acciones.alIrA(1) },
                    Pestana("📊", stringResource(R.string.pestana_resumen), false) { acciones.alIrA(2) },
                    Pestana("🧳", stringResource(R.string.pestana_viaje), false) { acciones.alIrA(3) },
                ),
            )
    }
}

@Preview(widthDp = 390, heightDp = 844)
@Composable
private fun Vista() = TemaCuaderno { HoyPantalla(HoyEstado(cargando = false, titulo = "Brasil 2027 🌴", sincronizacion = "Al día"), AccionesDeHoy()) }
