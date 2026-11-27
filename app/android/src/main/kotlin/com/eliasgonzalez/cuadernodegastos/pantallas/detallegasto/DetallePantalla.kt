// El detalle de un gasto: el monto, qué fue y sus datos; desde acá se edita o se manda a la papelera.
package com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto

import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.fadeIn
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonPrincipal
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.colorDe
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraSuperior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.IconoDeBarra
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonDePeligro
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.IconoRedondo
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.AvisoBreve
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.Tarjeta
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

data class AccionesDeDetalle(
    val alVolver: () -> Unit = {},
    val alEditar: () -> Unit = {},
    val alEnviarAPapelera: () -> Unit = {},
    val alRestaurar: () -> Unit = {},
)

@Composable
fun DetallePantalla(estado: DetalleEstado, acciones: AccionesDeDetalle, enviando: Boolean = false, fallo: FalloDeDetalle? = null, aviso: String? = null) {
    Column(Modifier.fillMaxSize().background(Tema.colores.fondo).systemBarsPadding()) {
        BarraSuperior(stringResource(R.string.detalle_titulo), icono = IconoDeBarra.VOLVER, alTocarIcono = acciones.alVolver)
        if (estado.noSePudoLeer) {
            Text(
                stringResource(R.string.no_se_pudo_leer), style = Tema.texto.cuerpo, color = Tema.colores.apagado, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(32.dp),
            )
            return@Column
        }
        if (estado.noExiste) {
            Text(
                stringResource(R.string.detalle_no_existe), style = Tema.texto.cuerpo, color = Tema.colores.apagado, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(32.dp),
            )
            return@Column
        }
        if (estado.cargando) return@Column
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).wrapContentWidth().widthIn(max = 600.dp).padding(horizontal = Tema.espacios.l),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Tema.espacios.m),
        ) {
            // el monto y qué fue, leídos juntos
            Column(Modifier.fillMaxWidth().padding(top = Tema.espacios.s).semantics(mergeDescendants = true) {}, horizontalAlignment = Alignment.CenterHorizontally) {
                IconoRedondo(estado.emoji, colorDe(estado.fondo), tamano = 72.dp)
                // un monto largo achica la letra para entrar en un renglón (como al cargarlo)
                BasicText(
                    estado.monto, maxLines = 1, softWrap = false, modifier = Modifier.fillMaxWidth().padding(top = Tema.espacios.s),
                    style = TextStyle(fontWeight = FontWeight.Bold, color = Tema.colores.tinta, textAlign = TextAlign.Center),
                    autoSize = TextAutoSize.StepBased(minFontSize = 22.sp, maxFontSize = 34.sp),
                )
                // con letra grande, cada parte en su renglón (sin un "·" colgando al final)
                if (estado.subtitulo.isNotEmpty()) {
                    val partes = if (LocalDensity.current.fontScale >= 1.3f) estado.subtitulo.split("\u00A0· ") else listOf(estado.subtitulo)
                    for (p in partes) Text(p, style = Tema.texto.cuerpo, color = Tema.colores.apagado, textAlign = TextAlign.Center)
                }
                if (estado.pendiente) Text(stringResource(R.string.detalle_sin_enviar), style = Tema.texto.etiqueta, color = Tema.colores.aviso, modifier = Modifier.padding(top = Tema.espacios.xs))
            }
            if (estado.enPapelera) {
                Text(stringResource(R.string.detalle_en_papelera), style = Tema.texto.cuerpo, color = Tema.colores.error, textAlign = TextAlign.Center)
            }
            if (estado.enPapelera && fallo == FalloDeDetalle.RESTAURAR) {
                Text(stringResource(R.string.detalle_no_se_pudo_restaurar), style = Tema.texto.aviso, color = Tema.colores.error, modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite })
            }
            Tarjeta {
                // con letra grande la etiqueta va arriba y el valor debajo (lado a lado se parte en zigzag)
                val apilar = LocalDensity.current.fontScale >= 1.3f
                estado.datos.forEachIndexed { i, d ->
                    // un valor largo (que iría en dos renglones alineado a la derecha) también va debajo de su etiqueta
                    if (apilar || d.valor.length > 28) {
                        Column(Modifier.fillMaxWidth().padding(vertical = Tema.espacios.s).semantics(mergeDescendants = true) {}) {
                            Text(d.etiqueta, style = Tema.texto.cuerpo, color = Tema.colores.etiqueta)
                            Text(d.valor, style = Tema.texto.cuerpo, color = Tema.colores.tinta)
                        }
                    } else {
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = Tema.espacios.s).semantics(mergeDescendants = true) {},
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Tema.espacios.m),
                        ) {
                            Text(d.etiqueta, style = Tema.texto.cuerpo, color = Tema.colores.etiqueta)
                            Text(d.valor, style = Tema.texto.cuerpo, color = Tema.colores.tinta, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                        }
                    }
                    if (i < estado.datos.lastIndex || estado.nota != null) HorizontalDivider(color = Tema.colores.linea)
                }
                // la nota puede ser larga: la etiqueta arriba y el texto debajo, a todo el ancho
                estado.nota?.let {
                    Column(Modifier.fillMaxWidth().padding(vertical = Tema.espacios.s).semantics(mergeDescendants = true) {}) {
                        Text(stringResource(R.string.gasto_nota), style = Tema.texto.cuerpo, color = Tema.colores.etiqueta, modifier = Modifier.padding(bottom = Tema.espacios.xs))
                        Text(it, style = Tema.texto.cuerpo, color = Tema.colores.tinta)
                    }
                }
            }
            // la papelera, lejos de la acción de abajo (así un toque de más no la manda)
            if (!estado.enPapelera) {
                if (fallo == FalloDeDetalle.PAPELERA) {
                    Text(
                        stringResource(R.string.detalle_no_se_pudo), style = Tema.texto.aviso, color = Tema.colores.error,
                        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
                BotonDePeligro(
                    stringResource(if (enviando) R.string.detalle_enviando else R.string.detalle_a_la_papelera), { if (!enviando) acciones.alEnviarAPapelera() },
                    Modifier.fillMaxWidth().padding(top = Tema.espacios.l),
                )
            }
            Spacer(Modifier.height(Tema.espacios.l))
        }
        // en la papelera, lo único que se hace es restaurarlo (no se edita)
        if (estado.enPapelera) {
            Column(Modifier.padding(horizontal = Tema.espacios.l, vertical = Tema.espacios.s)) {
                BotonPrincipal(stringResource(if (enviando) R.string.detalle_restaurando else R.string.detalle_restaurar), { if (!enviando) acciones.alRestaurar() }, Modifier.fillMaxWidth(), habilitado = !enviando)
            }
        }
        // abajo, la acción frecuente: editar (mientras se manda a la papelera no se edita: el gasto se va)
        if (!estado.enPapelera) {
            Column(Modifier.padding(horizontal = Tema.espacios.l, vertical = Tema.espacios.s), verticalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
                // el mismo movimiento que el aviso de abajo de Hoy y Gastos
                var ultimo by remember { mutableStateOf("") }
                if (aviso != null) ultimo = aviso
                androidx.compose.animation.AnimatedVisibility(aviso != null, enter = fadeIn() + slideInVertically { it / 2 }, exit = fadeOut()) {
                    Box(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) { AvisoBreve(ultimo) }
                }
                BotonPrincipal(stringResource(R.string.detalle_editar_boton), { if (!enviando) acciones.alEditar() }, Modifier.fillMaxWidth(), habilitado = !enviando)
            }
        }
    }
}

@Preview(widthDp = 390, heightDp = 844)
@Composable
private fun Vista() = TemaCuaderno {
    DetallePantalla(
        DetalleEstado(
            cargando = false, emoji = "🍽️", fondo = "#FDE3D3", monto = "R$ 137,50", subtitulo = "Almuerzo en familia · Comida",
            datos = listOf(DatoDelGasto("Quién", "🦁 Papá"), DatoDelGasto("Cuándo", "Jue 18 feb · 13:48"), DatoDelGasto("Lugar", "Restaurante Do Porto"), DatoDelGasto("Pago", "Crédito · Visa de Papá")),
        ),
        AccionesDeDetalle(),
    )
}
