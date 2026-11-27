// Gastos: los del viaje (o los de la preparación) día por día, con lo gastado cada día; tocar uno abre su detalle.
package com.eliasgonzalez.cuadernodegastos.pantallas.gastos

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.key
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.selection.selectableGroup
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
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.AvisoDeAbajo
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.AvisoDeGastos
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.FilaDeGasto
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.GastoEnPantalla
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraInferior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraSuperior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.Pestana
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonFlotante
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.ChipDeOpcion
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.IndicadorDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

data class AccionesDeGastos(
    val alElegirPestana: (Int) -> Unit = {},
    val alAbrirGasto: (String) -> Unit = {},
    val alCargarGasto: () -> Unit = {},
    val alIrA: (Int) -> Unit = {},
    val alDeshacer: () -> Unit = {},
)

/** Lo que queda libre al final para que el botón de cargar no tape el último gasto, y dónde va el aviso. */
private val espacioBajoLaLista = 96.dp

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun GastosPantalla(estado: GastosEstado, pestana: Int, acciones: AccionesDeGastos, aviso: AvisoDeGastos? = null) {
    val dias = if (pestana == 0) estado.delViaje else estado.preparacion
    Column(Modifier.fillMaxSize().background(Tema.colores.fondo).systemBarsPadding()) {
        BarraSuperior(stringResource(R.string.pestana_gastos)) { IndicadorDeSincronizacion(estado.sincronizacion, estado.tono) }
        // con letra grande van una debajo de la otra (lado a lado se cortan las palabras)
        if (LocalDensity.current.fontScale >= 1.3f) {
            Column(Modifier.fillMaxWidth().padding(horizontal = Tema.espacios.l).selectableGroup(), verticalArrangement = Arrangement.spacedBy(Tema.espacios.xs)) {
                ChipDeOpcion(stringResource(R.string.gastos_del_viaje), pestana == 0, { acciones.alElegirPestana(0) }, Modifier.fillMaxWidth(), llenar = true)
                ChipDeOpcion(stringResource(R.string.gastos_preparacion), pestana == 1, { acciones.alElegirPestana(1) }, Modifier.fillMaxWidth(), llenar = true)
            }
        } else {
            Row(Modifier.fillMaxWidth().padding(horizontal = Tema.espacios.l).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
                ChipDeOpcion(stringResource(R.string.gastos_del_viaje), pestana == 0, { acciones.alElegirPestana(0) }, Modifier.weight(1f), llenar = true)
                ChipDeOpcion(stringResource(R.string.gastos_preparacion), pestana == 1, { acciones.alElegirPestana(1) }, Modifier.weight(1f), llenar = true)
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            // una lista por pestaña: cambiar de pestaña no anima filas que se van y vienen (no quedan encimadas)
            // cada pestaña recuerda hasta dónde se bajó
            val desplazamientos = listOf(rememberLazyListState(), rememberLazyListState())
            key(pestana) {
            val desplazamiento = desplazamientos[pestana]
            // en horizontal o tablet, un ancho cómodo de lectura y centrado
            LazyColumn(Modifier.fillMaxSize().wrapContentWidth().widthIn(max = 600.dp).padding(horizontal = Tema.espacios.l), state = desplazamiento) {
                // la preparación se explica y se suma (quien entra por primera vez no sabe qué es)
                if (pestana == 1 && estado.antesDe != null) {
                    item(key = "explicacion") {
                        Column(
                            Modifier.fillMaxWidth().padding(top = Tema.espacios.m, bottom = Tema.espacios.s).background(Tema.colores.principalSuave, Tema.formas.tarjeta)
                                .padding(Tema.espacios.m),
                            verticalArrangement = Arrangement.spacedBy(Tema.espacios.xs),
                        ) {
                            Text(stringResource(R.string.gastos_preparacion_explica, estado.antesDe), style = Tema.texto.cuerpo, color = Tema.colores.etiqueta)
                            estado.totalPreparacion?.let {
                                Text(stringResource(R.string.gastos_preparacion_total, it), style = Tema.texto.fuerte, color = Tema.colores.tinta)
                            }
                        }
                    }
                }
                if (estado.noSePudoLeer) {
                    item { Text(stringResource(R.string.no_se_pudo_leer), style = Tema.texto.cuerpo, color = Tema.colores.apagado, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 32.dp)) }
                } else if (pestana == 1 && estado.antesDe == null && !estado.cargando) {
                    item { Text(stringResource(R.string.gastos_sin_inicio), style = Tema.texto.cuerpo, color = Tema.colores.apagado, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 32.dp)) }
                } else if (!estado.cargando && dias.isEmpty()) {
                    item {
                        Column(Modifier.fillMaxWidth().padding(top = 32.dp, start = 20.dp, end = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("📒", fontSize = 48.sp, modifier = Modifier.clearAndSetSemantics {})
                            Text(
                                stringResource(if (pestana == 0) R.string.gastos_vacio_viaje else R.string.gastos_vacio_preparacion),
                                style = Tema.texto.cuerpo, color = Tema.colores.apagado, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 10.dp),
                            )
                        }
                    }
                }
                for (d in dias) {
                    // el día queda fijo arriba mientras se recorren sus gastos (se sabe de qué día es cada fila)
                    stickyHeader(key = "dia-${d.dia}") {
                        // el día y su total, leídos juntos como encabezado
                        // con letra grande el total baja a otro renglón en vez de partir el día
                        FlowRow(
                            Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null).fillMaxWidth().background(Tema.colores.fondo).padding(top = Tema.espacios.m, bottom = Tema.espacios.xs).semantics(mergeDescendants = true) { heading() },
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(d.titulo, style = Tema.texto.rotulo.copy(fontSize = 13.sp), color = Tema.colores.apagado)
                            Text(d.totales, style = Tema.texto.rotulo.copy(fontSize = 13.sp), color = Tema.colores.tinta)
                        }
                    }
                    itemsIndexed(d.gastos, key = { _, g -> g.id }) { i, g ->
                        // al irse o volver de la papelera, la fila se anima (se ve qué cambió)
                        // sin fundidos: la que se va desaparece y las de abajo suben (nunca encimadas); la primera carga aparece entera
                        Column(Modifier.animateItem(fadeInSpec = null, fadeOutSpec = null)) { FilaDeGasto(g, ultima = i == d.gastos.lastIndex) { acciones.alAbrirGasto(g.id) } }
                    }
                }
                item { Spacer(Modifier.height(espacioBajoLaLista)) }
            }
            // al desplazar, una línea (encima de todo, también del día fijo) marca dónde la lista pasa por debajo de las pestañas
            if (desplazamiento.canScrollBackward) HorizontalDivider(color = Tema.colores.linea)
            }
            BotonFlotante(stringResource(R.string.hoy_cargar), acciones.alCargarGasto, Modifier.align(Alignment.BottomCenter).padding(bottom = Tema.espacios.l))
            AvisoDeAbajo(aviso, acciones.alDeshacer, Modifier.align(Alignment.BottomCenter).padding(horizontal = Tema.espacios.l).padding(bottom = espacioBajoLaLista))
        }
        BarraInferior(
            listOf(
                Pestana("🏠", stringResource(R.string.pestana_hoy), false) { acciones.alIrA(0) },
                Pestana("📒", stringResource(R.string.pestana_gastos), true) { acciones.alIrA(1) },
                Pestana("📊", stringResource(R.string.pestana_resumen), false) { acciones.alIrA(2) },
                Pestana("🧳", stringResource(R.string.pestana_viaje), false) { acciones.alIrA(3) },
            ),
        )
    }
}

@Preview(widthDp = 390, heightDp = 844)
@Composable
private fun Vista() = TemaCuaderno {
    GastosPantalla(
        GastosEstado(
            cargando = false, sincronizacion = "Al día",
            delViaje = listOf(
                DiaEnPantalla(
                    "2027-02-18", "JUEVES 18 FEB", "₲ 250.000 · R$ 150,40",
                    listOf(GastoEnPantalla("1", "🍽️", "#FDE3D3", "Almuerzo en familia", "Restaurante Do Porto · Crédito", "🦁 Papá · 13:48", "R$ 137,50", "BRL", false)),
                ),
            ),
        ),
        0, AccionesDeGastos(),
    )
}
