// Paso 1 del nuevo viaje: nombre, fechas, monedas y cómo te ven los demás (apodo y emoji). La zona horaria se informa.
package com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.partes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Formatos
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Perfiles
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.colorDe
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.AccionesDeNuevoViaje
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.Arranque
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.NuevoViajeEstado
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.CampoDeTexto
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.CampoParaElegir
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.ElegirFecha
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.separacionDeCampos
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.AccionDeTexto
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.ChipParaElegir
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.IconoRedondo
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.Aviso
import com.eliasgonzalez.cuadernodegastos.ui.componentes.tarjetas.Tarjeta
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

private enum class Fecha { INICIO, FIN }

/** Cada emoji se toca en un círculo de 48 (área táctil mínima recomendada). */
private val tamanoDelEmoji = 48.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PasoDatos(estado: NuevoViajeEstado, acciones: AccionesDeNuevoViaje, alEnfocarElUltimo: () -> Unit = {}) {
    var eligiendo by remember { mutableStateOf<Fecha?>(null) }
    // "Siguiente" desde el nombre recorre campo por campo: salida, regreso y apodo (se corta si cierra un calendario sin elegir)
    var enCadena by remember { mutableStateOf(false) }
    var eligio by remember { mutableStateOf(false) }
    val focoDelApodo = remember { FocusRequester() }
    val textos = estado.errores.mapValues { stringResource(it.value) }
    val error = { campo: String -> textos[campo] }
    CampoDeTexto(stringResource(R.string.nuevo_nombre), estado.nombre, acciones.alCambiarNombre, ayuda = stringResource(R.string.nuevo_nombre_ayuda), error = error("nombre"), mayusculas = true, accion = ImeAction.Next,
        alSiguiente = { enCadena = true; eligiendo = Fecha.INICIO },
    )
    val salida = @Composable { m: Modifier ->
        CampoParaElegir(
            stringResource(R.string.nuevo_empieza), estado.fechaInicio?.let(Formatos::fechaCorta), { eligiendo = Fecha.INICIO }, m,
            ayuda = stringResource(R.string.nuevo_elegir_fecha), icono = Icons.Outlined.DateRange,
        )
    }
    val regreso = @Composable { m: Modifier ->
        CampoParaElegir(
            stringResource(R.string.nuevo_termina),
            if (estado.sinFechaFin) stringResource(R.string.nuevo_sin_fin_corto) else estado.fechaFin?.let(Formatos::fechaCorta),
            { eligiendo = Fecha.FIN },
            m,
            ayuda = stringResource(R.string.nuevo_elegir_fecha), icono = Icons.Outlined.DateRange, error = error("fecha_fin"), habilitado = !estado.sinFechaFin,
        )
    }
    // con letra grande no entran lado a lado: una debajo de la otra
    if (LocalDensity.current.fontScale >= 1.3f) {
        salida(Modifier.fillMaxWidth())
        regreso(Modifier.fillMaxWidth())
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
            salida(Modifier.weight(1f))
            regreso(Modifier.weight(1f))
        }
    }
    // una casilla de verdad, con toda la fila tocable (48 de alto)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).toggleable(value = estado.sinFechaFin, role = Role.Checkbox, onValueChange = { acciones.alCambiarSinFin() }),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = estado.sinFechaFin, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = Tema.colores.principal))
        Column(Modifier.padding(start = Tema.espacios.s)) {
            Text(stringResource(R.string.nuevo_sin_fin), style = Tema.texto.cuerpo, color = Tema.colores.dato)
            Text(stringResource(R.string.nuevo_sin_fin_ayuda), style = Tema.texto.chico, color = Tema.colores.apagado)
        }
    }
    Aviso(null, {
        Text(
            when (estado.arranque) {
                Arranque.SIN_SALIDA -> stringResource(R.string.nuevo_aviso_sin_salida)
                Arranque.FALTA -> stringResource(R.string.nuevo_aviso_falta, estado.salidaParaLeer)
                Arranque.HOY -> stringResource(R.string.nuevo_aviso_hoy)
                Arranque.YA_ARRANCO -> stringResource(R.string.nuevo_aviso_ya_arranco, estado.salidaParaLeer)
            },
            style = Tema.texto.aviso,
            color = Tema.colores.tintaDelAviso,
        )
    })
    // se informa (todavía no se cambia): como texto, no como un campo que parece tocable
    Text(stringResource(R.string.nuevo_horario, estado.ciudad), style = Tema.texto.cuerpo.copy(fontSize = 14.sp), color = Tema.colores.apagado)
    Tarjeta(titulo = stringResource(R.string.nuevo_monedas), borde = if (error("monedas") != null) Tema.colores.error else Tema.colores.linea) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s), verticalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
            for (m in estado.monedas) {
                ChipParaElegir("${m.moneda.simbolo} ${m.nombre}", m.elegida) { acciones.alCambiarMoneda(m.moneda.codigo) }
            }
            AccionDeTexto(stringResource(R.string.nuevo_agregar_moneda), Icons.Filled.Add, acciones.alAgregarMoneda)
        }
        error("monedas")?.let { Text(it, style = Tema.texto.error, color = Tema.colores.error, modifier = Modifier.padding(top = Tema.espacios.s)) }
    }
    Tarjeta(titulo = stringResource(R.string.nuevo_como_te_ven)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s), modifier = Modifier.padding(bottom = Tema.espacios.m)) {
            Perfiles.emojis.forEachIndexed { i, e ->
                IconoRedondo(e.emoji, colorDe(e.fondo), tamano = tamanoDelEmoji, marcado = i == estado.emoji, descripcion = stringResource(R.string.nuevo_emoji_descripcion, e.emoji)) { acciones.alElegirEmoji(i) }
            }
        }
        CampoDeTexto(stringResource(R.string.nuevo_apodo), estado.apodo, acciones.alCambiarApodo, ayuda = stringResource(R.string.nuevo_apodo_ayuda), error = error("apodo"), mayusculas = true, accion = ImeAction.Done, alEnfocar = alEnfocarElUltimo, seguirAlTeclado = false,
            pedidoDeFoco = focoDelApodo,
        )
    }
    when (eligiendo) {
        Fecha.INICIO -> ElegirFecha(estado.fechaInicio, stringResource(R.string.listo), stringResource(R.string.borrar), { acciones.alElegirInicio(it); eligio = it != null }) {
            val seguir = enCadena && eligio
            eligiendo = if (seguir && !estado.sinFechaFin) Fecha.FIN else null
            if (seguir && estado.sinFechaFin) focoDelApodo.requestFocus()
            if (!seguir || estado.sinFechaFin) enCadena = false
            eligio = false
        }
        Fecha.FIN -> ElegirFecha(estado.fechaFin, stringResource(R.string.listo), stringResource(R.string.borrar), { acciones.alElegirFin(it); eligio = it != null }) {
            eligiendo = null
            if (enCadena && eligio) focoDelApodo.requestFocus()
            enCadena = false
            eligio = false
        }
        null -> Unit
    }
}

/** El espacio entre campos de este paso (el mismo de todos los formularios). */
internal val espacioDelPaso = separacionDeCampos
