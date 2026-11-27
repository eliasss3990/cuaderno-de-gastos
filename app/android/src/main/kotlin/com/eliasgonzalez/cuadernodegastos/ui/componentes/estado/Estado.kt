// Piezas chicas de estado: el chip, el indicador de sincronización y el ícono redondo.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.estado

import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.ripple
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

@Composable
fun Chip(texto: String, activo: Boolean = false, alTocar: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    val forma = Tema.formas.chip
    Text(
        texto,
        style = Tema.texto.chip.copy(fontWeight = if (activo) FontWeight.SemiBold else FontWeight.Normal),
        color = if (activo) Tema.colores.principal else Tema.colores.tinta,
        maxLines = 1,
        modifier = modifier
            .clip(forma)
            .background(if (activo) Tema.colores.principalSuave else Tema.colores.superficie, forma)
            .border(BorderStroke(1.dp, if (activo) Tema.colores.principal else Tema.colores.bordeDeCampo), forma)
            .let { if (alTocar != null) it.clickable(onClick = alTocar) else it }
            .padding(horizontal = 11.dp, vertical = 5.dp),
    )
}

/**
 * Una opción que se marca y se desmarca (por ejemplo, una moneda del viaje): casilla a la izquierda, se toca en un alto
 * de 48 aunque se vea de 40.
 */
@Composable
fun ChipParaElegir(texto: String, elegido: Boolean, alCambiar: () -> Unit) {
    val forma = Tema.formas.chip
    // se toca en 48 de alto, pero el efecto del toque tiene la forma de la píldora que se ve
    val fuente = remember { MutableInteractionSource() }
    Box(Modifier.heightIn(min = 48.dp).toggleable(value = elegido, role = Role.Checkbox, interactionSource = fuente, indication = null, onValueChange = { alCambiar() }), contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .heightIn(min = 40.dp)
                .clip(forma)
                .indication(fuente, ripple())
                .background(if (elegido) Tema.colores.principalSuave else Tema.colores.superficie, forma)
                .border(BorderStroke(1.dp, if (elegido) Tema.colores.principal else Tema.colores.bordeDeCampo), forma)
                .padding(start = 4.dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = elegido, onCheckedChange = null, modifier = Modifier.padding(horizontal = 6.dp), colors = CheckboxDefaults.colors(checkedColor = Tema.colores.principal, uncheckedColor = Tema.colores.etiqueta))
            Text(texto, style = Tema.texto.cuerpo.copy(fontWeight = if (elegido) FontWeight.SemiBold else FontWeight.Normal), color = if (elegido) Tema.colores.principal else Tema.colores.dato, maxLines = 1)
        }
    }
}

/**
 * Una opción entre varias (se elige una sola: una categoría, la forma de pago); la elegida lleva ✓ además del color.
 * Se toca en un alto de 48.
 */
@Composable
fun ChipDeOpcion(
    texto: String,
    elegido: Boolean,
    alTocar: () -> Unit,
    modifier: Modifier = Modifier,
    /** Va delante y el lector de pantalla lo salta (lee el texto). */
    emoji: String? = null,
    /** Que la píldora llene el ancho que le dan (un control segmentado). */
    llenar: Boolean = false,
    /** Tocar el elegido lo desmarca: se anuncia como casilla (el lector de pantalla también puede desmarcarlo). */
    desmarcable: Boolean = false,
) {
    val forma = Tema.formas.chip
    val fuente = remember { MutableInteractionSource() }
    val tocable = if (desmarcable) {
        Modifier.toggleable(value = elegido, role = Role.Checkbox, interactionSource = fuente, indication = null, onValueChange = { alTocar() })
    } else {
        Modifier.selectable(selected = elegido, role = Role.RadioButton, interactionSource = fuente, indication = null, onClick = alTocar)
    }
    Box(modifier.heightIn(min = 48.dp).then(tocable), contentAlignment = Alignment.Center) {
        Row(
            Modifier
                .let { if (llenar) it.fillMaxWidth() else it }
                .heightIn(min = 40.dp)
                .clip(forma)
                .indication(fuente, ripple())
                .background(if (elegido) Tema.colores.principalSuave else Tema.colores.superficie, forma)
                .border(BorderStroke(if (elegido) 2.dp else 1.dp, if (elegido) Tema.colores.principal else Tema.colores.bordeDeCampo), forma)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            // un lugar fijo adelante (✓ al elegir, si no el emoji o vacío): el chip no cambia de ancho al elegirlo
            Box(Modifier.padding(end = 6.dp).size(22.dp), contentAlignment = Alignment.Center) {
                when {
                    elegido -> Icon(Icons.Filled.Check, contentDescription = null, tint = Tema.colores.principal, modifier = Modifier.size(18.dp))
                    emoji != null -> Text(emoji, style = Tema.texto.cuerpo, modifier = Modifier.clearAndSetSemantics {})
                    else -> Box(Modifier.size(16.dp).border(1.5.dp, Tema.colores.bordeDeCampo, CircleShape))
                }
            }
            Text(texto, style = Tema.texto.cuerpo.copy(fontWeight = if (elegido) FontWeight.SemiBold else FontWeight.Normal), color = if (elegido) Tema.colores.principal else Tema.colores.dato, maxLines = 1)
        }
    }
}

/** Una acción con forma de chip (por ejemplo, completar un campo con algo ya usado): se anuncia como botón. */
@Composable
fun ChipDeAccion(texto: String, alTocar: () -> Unit, modifier: Modifier = Modifier) {
    val forma = Tema.formas.chip
    val fuente = remember { MutableInteractionSource() }
    Box(modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).clickable(role = Role.Button, interactionSource = fuente, indication = null, onClick = alTocar), contentAlignment = Alignment.Center) {
        Text(
            texto, style = Tema.texto.cuerpo, color = Tema.colores.principal, maxLines = 1, textAlign = TextAlign.Center,
            modifier = Modifier.heightIn(min = 40.dp).clip(forma).indication(fuente, ripple()).background(Tema.colores.superficie, forma)
                .border(BorderStroke(1.dp, Tema.colores.bordeDeCampo), forma).padding(horizontal = 14.dp, vertical = 9.dp),
        )
    }
}

/** Una acción en texto con un ícono (por ejemplo, "agregar moneda"): sin borde, en el color principal, 48 de alto. */
@Composable
fun AccionDeTexto(texto: String, icono: ImageVector, alTocar: () -> Unit) {
    Row(
        Modifier.heightIn(min = 48.dp).clip(Tema.formas.chip).clickable(role = Role.Button, onClick = alTocar).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icono, contentDescription = null, tint = Tema.colores.principal)
        Text(texto, style = Tema.texto.cuerpo.copy(fontWeight = FontWeight.SemiBold), color = Tema.colores.principal, modifier = Modifier.padding(start = 6.dp))
    }
}

/** Cómo se ve el indicador: al día (verde), pendiente (ámbar) o sin conexión o con error (rojo). */
enum class Tono { BIEN, PENDIENTE, MAL }

@Composable
fun IndicadorDeSincronizacion(texto: String, tono: Tono) {
    val (fondo, letra) = when (tono) {
        Tono.BIEN -> Tema.colores.bienSuave to Tema.colores.bien
        Tono.PENDIENTE -> Tema.colores.avisoSuave to Tema.colores.aviso
        Tono.MAL -> Tema.colores.errorSuave to Tema.colores.error
    }
    val signo = when (tono) {
        Tono.BIEN -> "●"
        Tono.PENDIENTE -> "↑"
        Tono.MAL -> "⚠"
    }
    Row(Modifier.background(fondo, RoundedCornerShape(14.dp)).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        // el signo acompaña al color; el lector de pantalla lee solo el texto
        Text(signo, style = Tema.texto.estadoDeSincronizacion, color = letra, modifier = Modifier.padding(end = 4.dp).clearAndSetSemantics {})
        Text(texto, style = Tema.texto.estadoDeSincronizacion, color = letra)
    }
}

/** Un emoji en un círculo de color (el de la categoría o el del integrante). */
@Composable
fun IconoRedondo(emoji: String, fondo: Color, tamano: Dp = 42.dp, apagado: Boolean = false, marcado: Boolean = false, descripcion: String? = null, alTocar: (() -> Unit)? = null) {
    Box(
        Modifier
            .size(tamano)
            .let { if (marcado) it.border(3.dp, Tema.colores.principal, CircleShape) else it }
            .clip(CircleShape)
            .background(fondo)
            .alpha(if (apagado) 0.3f else 1f)
            .let { if (alTocar != null) it.clickable(onClick = alTocar) else it }
            // con descripción se anuncia; sin ella es decorativo y el lector lo salta
            .let { if (descripcion != null) it.semantics { contentDescription = descripcion; selected = marcado } else it.clearAndSetSemantics {} },
        contentAlignment = Alignment.Center,
    ) {
        Text(emoji, fontSize = (tamano.value / 2).sp)
    }
}
