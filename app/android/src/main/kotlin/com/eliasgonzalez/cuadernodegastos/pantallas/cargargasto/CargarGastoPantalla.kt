// Cargar un gasto: moneda, monto con su teclado, categoría, forma de pago y lugar a la vista; el resto en "más datos".
// Las partes viven en `partes/`.
package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto

import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.animation.core.tween
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.expandVertically
import androidx.compose.foundation.layout.size
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.text.BasicText
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import com.eliasgonzalez.cuadernodegastos.ui.componentes.dialogos.DialogoDeConfirmar
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.AccionDeTexto
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.gastos.AvisoDelTope
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.partes.MasDatos
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.partes.TecladoDelMonto
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.BarraSuperior
import com.eliasgonzalez.cuadernodegastos.ui.componentes.barras.IconoDeBarra
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonPrincipal
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.CampoDeTexto
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.separacionDeCampos
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.ChipDeAccion
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.ChipDeOpcion
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Formatos
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

/** Los toques de la pantalla. */
data class AccionesDeCargarGasto(
    val alCerrar: () -> Unit = {},
    /** Guardado: el id del gasto y el monto para leer. */
    val alGuardado: (GastoGuardado) -> Unit = {},
    val alTocarTecla: (Char) -> Unit = {},
    val alBorrar: () -> Unit = {},
    val alBorrarTodo: () -> Unit = {},
    val alElegirMoneda: (String) -> Unit = {},
    val alElegirCategoria: (String) -> Unit = {},
    val alElegirMetodo: (String) -> Unit = {},
    val alCambiarLugar: (String) -> Unit = {},
    val alCambiarConcepto: (String) -> Unit = {},
    val alCambiarAlias: (String) -> Unit = {},
    val alCambiarNota: (String) -> Unit = {},
    val alElegirDia: (String) -> Unit = {},
    val alMostrarMas: () -> Unit = {},
    val alGuardar: () -> Unit = {},
)

private val tamanoDelMonto = 44.sp
private val altoDelMonto = 60.dp
private val altoDelAviso = 48.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CargarGastoPantalla(estado: CargarGastoEstado, acciones: AccionesDeCargarGasto) {
    var preguntarSiSale by rememberSaveable { mutableStateOf(false) }
    val cerrar = { if (estado.enviando) Unit else if (estado.cargoAlgo) preguntarSiSale = true else acciones.alCerrar() }
    LaunchedEffect(estado.listo) { if (estado.listo) estado.guardado?.let { acciones.alGuardado(it) } ?: acciones.alCerrar() }
    if (preguntarSiSale) {
        DialogoDeConfirmar(
            stringResource(if (estado.editando) R.string.gasto_salir_editar else R.string.gasto_salir_titulo), stringResource(if (estado.editando) R.string.gasto_salir_editar_texto else R.string.nuevo_salir_texto),
            stringResource(if (estado.editando) R.string.gasto_seguir_editando else R.string.nuevo_seguir_cargando),
            stringResource(if (estado.editando) R.string.gasto_salir_sin_guardar else R.string.nuevo_salir),
            alSeguir = { preguntarSiSale = false }, alSalir = { preguntarSiSale = false; acciones.alCerrar() },
        )
    }
    val moneda = estado.monedaElegida
    val desplazamiento = rememberScrollState()
    // si falta el monto, se vuelve arriba para que se vea el error
    LaunchedEffect(estado.errorDelMonto) { if (estado.errorDelMonto != null) desplazamiento.animateScrollTo(0) }
    var todosLosPagos by rememberSaveable { mutableStateOf(false) }
    // el teclado del monto se ve solo mientras se edita el monto: al abrir "Más datos" o escribir en otro campo se guarda,
    // y se vuelve a abrir tocando el monto
    // editando, el teclado arranca cerrado: se ve todo el gasto y se toca lo que se quiere cambiar
    var montoActivo by rememberSaveable { mutableStateOf(!estado.editando) }
    // dónde termina el monto en lo que se desplaza: el resumen fijo aparece solo si el monto salió de la vista
    var finDelMonto by remember { mutableStateOf(0) }
    // volver: primero cierra el teclado del monto (como el del sistema); recién con el teclado cerrado sale de la pantalla
    BackHandler(onBack = { if (montoActivo) montoActivo = false else cerrar() })
    LaunchedEffect(estado.errorDelMonto) { if (estado.errorDelMonto != null) montoActivo = true }
    val lugarALaVista = remember { BringIntoViewRequester() }
    val alcance = rememberCoroutineScope()
    val foco = LocalFocusManager.current
    val teclado = LocalSoftwareKeyboardController.current
    val tecladoDelSistema = WindowInsets.isImeVisible
    // al cerrar el teclado del sistema, el campo suelta el foco: el teclado del monto vuelve a escribir solo en el monto
    LaunchedEffect(tecladoDelSistema) {
        if (tecladoDelSistema) {
            montoActivo = false
        } else {
            // el teclado de números no vuelve solo: se abre al entrar y después solo tocando el monto
            foco.clearFocus()
        }
    }
    Column(Modifier.fillMaxSize().background(Tema.colores.fondo).systemBarsPadding().imePadding()) {
        BarraSuperior(stringResource(if (estado.editando) R.string.gasto_titulo_editar else R.string.gasto_titulo), icono = IconoDeBarra.CERRAR, alTocarIcono = cerrar)
        // mientras carga, solo la barra: nunca un formulario con valores falsos ("0", sin moneda) que después salta
        if (estado.cargando) return@Column
        // con el teclado del sistema abierto el monto sale de la vista: un resumen fijo para no guardar a ciegas
        if (tecladoDelSistema && estado.montoTexto.isNotEmpty() && desplazamiento.value > finDelMonto) {
            // la categoría solo si su sección se ve (no nombrar lo que la persona no vio)
            val categoria = estado.categorias.takeIf { it.size > 1 }?.firstOrNull { it.id == estado.categoria }?.nombre
            val pago = METODOS_DE_PAGO.firstOrNull { it.codigo == estado.metodo }?.texto
            Text(
                listOfNotNull("${moneda?.simbolo.orEmpty()} ${estado.montoTexto}", categoria, pago).joinToString(" · "),
                style = Tema.texto.fuerte, color = Tema.colores.tinta, maxLines = 1,
                modifier = Modifier.fillMaxWidth().background(Tema.colores.principalSuave).padding(horizontal = Tema.espacios.l, vertical = Tema.espacios.s),
            )
        }
        Column(
            // en horizontal o tablet, el mismo ancho de lectura que la lista y el detalle
            Modifier.fillMaxWidth().weight(1f).verticalScroll(desplazamiento).wrapContentWidth().widthIn(max = 600.dp).padding(horizontal = Tema.espacios.l),
            verticalArrangement = Arrangement.spacedBy(separacionDeCampos),
        ) {
            if (estado.monedas.size > 1) {
                Row(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
                    for (m in estado.monedas) {
                        ChipDeOpcion("${m.simbolo} ${estado.nombresDeMoneda[m.codigo] ?: m.codigo}", m.codigo == estado.moneda, { acciones.alElegirMoneda(m.codigo) }, Modifier.weight(1f), llenar = true)
                    }
                }
            }
            Monto(estado, moneda, activo = montoActivo && !tecladoDelSistema, Modifier.onGloballyPositioned { finDelMonto = it.positionInParent().y.toInt() + it.size.height }) {
                foco.clearFocus(); montoActivo = true
            }
            // con una sola categoría ("Otro") no hay nada que elegir: la sección no se muestra
            if (estado.categorias.size > 1) {
                Text(stringResource(R.string.gasto_categoria), style = Tema.texto.etiqueta, color = Tema.colores.etiqueta, modifier = Modifier.padding(top = Tema.espacios.s))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
                    for (c in estado.categorias) ChipDeOpcion(c.nombre, c.id == estado.categoria, { acciones.alElegirCategoria(c.id) }, emoji = c.emoji.ifBlank { null })
                }
            }
            Text(stringResource(R.string.gasto_pago), style = Tema.texto.etiqueta, color = Tema.colores.etiqueta, modifier = Modifier.padding(top = Tema.espacios.s))
            // los 4 más comunes a la vista; el resto con "+ más" (el elegido se ve siempre)
            val pagos = if (todosLosPagos) METODOS_DE_PAGO else METODOS_DE_PAGO.take(4) + METODOS_DE_PAGO.drop(4).filter { it.codigo == estado.metodo }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
                for (p in pagos) ChipDeOpcion(p.texto, p.codigo == estado.metodo, { acciones.alElegirMetodo(p.codigo) }, desmarcable = true)
                if (!todosLosPagos) AccionDeTexto(stringResource(R.string.gasto_mas_pagos), Icons.Filled.KeyboardArrowDown) { todosLosPagos = true }
            }
            // al escribir el lugar, que el campo y sus sugerencias queden arriba del botón (el teclado del sistema achica la pantalla)
            Column(Modifier.bringIntoViewRequester(lugarALaVista), verticalArrangement = Arrangement.spacedBy(separacionDeCampos)) {
                CampoDeTexto(stringResource(R.string.gasto_lugar), estado.lugar, acciones.alCambiarLugar, ayuda = stringResource(R.string.gasto_lugar_ayuda), mayusculas = true, accion = ImeAction.Done, largoMaximo = CORTO,
                    seguirAlTeclado = false,
                    alEnfocar = { alcance.launch { withTimeoutOrNull(1200) { snapshotFlow { desplazamiento.maxValue }.collect { lugarALaVista.bringIntoView() } } } },
                )
                // las sugerencias quedan quietas al usarlas (no desaparecen bajo el dedo)
                val escrito = sinTildes(estado.lugar.trim())
                val sugeridos = estado.sugerenciasDeLugar.filter { (escrito.isEmpty() || sinTildes(it).contains(escrito)) && sinTildes(it) != escrito }
                if (sugeridos.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) { for (s in sugeridos) ChipDeAccion(s, { acciones.alCambiarLugar(s); foco.clearFocus() }) }
                }
            }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = { montoActivo = estado.mostrarMas && montoActivo; acciones.alMostrarMas() })
                    .padding(horizontal = Tema.espacios.s),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val rotulo = when {
                    estado.mostrarMas -> stringResource(R.string.gasto_menos_datos)
                    // con otro día elegido, se ve aunque la sección esté cerrada
                    // el día manda (si no es hoy y no se ve, el gasto parece de hoy); después lo escrito
                    estado.diaImputado != estado.diaPropuesto -> stringResource(R.string.gasto_mas_datos_dia, Formatos.fechaLarga(estado.diaImputado))
                    estado.concepto.isNotBlank() -> stringResource(R.string.gasto_mas_datos_con, estado.concepto.trim())
                    estado.conTarjeta -> stringResource(R.string.gasto_mas_datos_tarjeta)
                    else -> stringResource(R.string.gasto_mas_datos)
                }
                Text(rotulo, style = Tema.texto.cuerpo.copy(fontWeight = FontWeight.SemiBold), color = Tema.colores.principal, modifier = Modifier.weight(1f))
                Icon(if (estado.mostrarMas) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Tema.colores.principal)
            }
            if (estado.mostrarMas) MasDatos(estado, acciones)
        }
        // el aviso y guardar quedan fijos arriba del teclado: se ven sin desplazar
        Column(Modifier.padding(horizontal = Tema.espacios.l, vertical = Tema.espacios.s), verticalArrangement = Arrangement.spacedBy(Tema.espacios.s)) {
            estado.mensaje?.let {
                Text(stringResource(it), style = Tema.texto.aviso, color = Tema.colores.error, modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite })
            }
            // ya guardado sigue "Guardando…" hasta que la pantalla se va (si no, el botón vuelve a su estado normal un instante)
            val guardando = estado.enviando || (estado.listo && estado.guardado != null)
            BotonPrincipal(stringResource(if (guardando) R.string.gasto_guardando else if (estado.editando) R.string.gasto_guardar_cambios else R.string.gasto_guardar), { teclado?.hide(); foco.clearFocus(); acciones.alGuardar() },
                // editando sin cambios queda apagado (no hay nada que guardar)
                habilitado = !guardando && (!estado.editando || estado.hayCambios), cargando = guardando)
        }
        // con el teclado del sistema abierto (lugar, nota) el del monto se esconde
        // entra y sale deslizándose (lo de arriba no salta de golpe)
        // mientras carga no se muestra (editando arranca cerrado: no aparece y se va)
        androidx.compose.animation.AnimatedVisibility(montoActivo && !tecladoDelSistema && !estado.cargando, enter = expandVertically(tween(200)), exit = shrinkVertically(tween(200))) {
            TecladoDelMonto(conComa = (moneda?.decimales ?: 0) > 0, acciones.alTocarTecla, acciones.alBorrar, acciones.alBorrarTodo, alCerrar = { montoActivo = false })
        }
    }
}

@Composable
private fun Monto(estado: CargarGastoEstado, moneda: Moneda?, activo: Boolean, modifier: Modifier = Modifier, alTocar: () -> Unit) {
    val simbolo = moneda?.simbolo.orEmpty()
    val vacio = estado.montoTexto.isEmpty()
    val error = estado.errorDelMonto?.let { stringResource(it) }
    val avisoDelTope = when (estado.avisoDelTope) {
        AvisoDelTope.YA_PASADO -> stringResource(R.string.gasto_tope_ya_pasado)
        AvisoDelTope.PASA_CON_ESTE -> stringResource(R.string.gasto_tope_con_este)
        AvisoDelTope.NINGUNO -> null
    }
    val quitadoLeido = estado.centavosQuitados?.let { stringResource(R.string.gasto_centavos_quitados, (estado.nombresDeMoneda[estado.moneda] ?: estado.moneda).lowercase(), "$simbolo ${estado.montoTexto}") }.orEmpty()
    // para el lector de pantalla: sin el signo ⚠ y un solo punto entre las partes
    val leido = stringResource(R.string.gasto_monto) + ": " + listOfNotNull(
        if (vacio) stringResource(R.string.gasto_monto_ayuda) else "$simbolo ${estado.montoTexto}",
        error, avisoDelTope, quitadoLeido.ifEmpty { null },
    ).joinToString(" ") { p -> p.removePrefix("⚠").trim().let { t -> if (t.endsWith(".") || t.endsWith("?")) t else "$t." } }
    val soloElMonto = stringResource(R.string.gasto_monto) + ": " + (if (vacio) stringResource(R.string.gasto_monto_ayuda) else "$simbolo ${estado.montoTexto}")
    // vacío muestra 0 (en gris, el primer número lo reemplaza)
    val texto = if (vacio) "$simbolo 0" else "$simbolo ${estado.montoTexto}"
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(role = Role.Button, onClickLabel = stringResource(R.string.gasto_editar_monto), onClick = alTocar)
            .padding(vertical = Tema.espacios.xs)
            .semantics(mergeDescendants = true) { contentDescription = leido },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(R.string.gasto_monto), style = Tema.texto.etiqueta, color = Tema.colores.etiqueta)
        // al teclear se anuncia solo el monto; los avisos, cuando cambian
        Box(Modifier.size(0.dp).semantics { contentDescription = soloElMonto; liveRegion = LiveRegionMode.Polite })
        val avisos = listOfNotNull(error, avisoDelTope, quitadoLeido.ifEmpty { null }).joinToString(" ") { it.removePrefix("⚠").trim() }
        if (avisos.isNotEmpty()) Box(Modifier.size(0.dp).semantics { contentDescription = avisos; liveRegion = LiveRegionMode.Polite })
        // el número y su raya con el mismo ancho, en un renglón de alto fijo: achicar la letra no mueve lo de abajo;
        // vacío, la raya marca dónde va el número (sin un "0" que parezca un dato)
        // el número usa todo el ancho (la letra que se ajusta no informa su ancho intrínseco: medirlo así lo dejaba en 0)
        val densidad = LocalDensity.current
        var anchoDelNumero by remember { mutableStateOf(0.dp) }
        Column(Modifier.fillMaxWidth().heightIn(min = altoDelMonto), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
            // un monto largo achica la letra solo lo que hace falta para entrar en el ancho
            BasicText(
                texto, maxLines = 1, softWrap = false, modifier = Modifier.fillMaxWidth(),
                style = TextStyle(fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, color = if (vacio) Tema.colores.ayuda else Tema.colores.tinta),
                autoSize = TextAutoSize.StepBased(minFontSize = 24.sp, maxFontSize = tamanoDelMonto),
                onTextLayout = { r -> anchoDelNumero = with(densidad) { (r.getLineRight(0) - r.getLineLeft(0)).toDp() } },
            )
            // la raya dice dónde escribe el teclado (del ancho del número): se ve mientras está abierto (roja con error)
            Box(Modifier.width(maxOf(anchoDelNumero, 72.dp)).height(3.dp).testTag("raya-del-monto").background(if (error != null) Tema.colores.error else if (activo) Tema.colores.acento else Color.Transparent))
        }
        // un solo texto debajo: el error, la ayuda para empezar o cómo volver a editar
        // un renglón de dos líneas reservado para el aviso: que aparezca o se vaya no mueve lo de abajo
        Box(Modifier.heightIn(min = altoDelAviso), contentAlignment = Alignment.TopCenter) {
        when {
            estado.centavosQuitados != null && error == null -> Text(stringResource(R.string.gasto_centavos_quitados, (estado.nombresDeMoneda[estado.moneda] ?: estado.moneda).lowercase(), "$simbolo ${estado.montoTexto}"), style = Tema.texto.chico.copy(fontSize = 14.sp), color = Tema.colores.etiqueta, textAlign = TextAlign.Center, modifier = Modifier.padding(top = Tema.espacios.xs))
            // el aviso del tope (ya pasado o pasa con este gasto): se avisa en rojo mientras se escribe, sin bloquear el guardado
            avisoDelTope != null && error == null -> Text(avisoDelTope, style = Tema.texto.error.copy(fontWeight = FontWeight.SemiBold), color = Tema.colores.error, textAlign = TextAlign.Center, modifier = Modifier.padding(top = Tema.espacios.xs))
            error != null -> Text(error, style = Tema.texto.error, color = Tema.colores.error, modifier = Modifier.padding(top = Tema.espacios.xs))
            !activo -> Text(stringResource(if (vacio) R.string.gasto_tocar_para_escribir else R.string.gasto_tocar_para_editar), style = Tema.texto.chico.copy(fontSize = 14.sp), color = Tema.colores.apagado, modifier = Modifier.padding(top = Tema.espacios.xs))
            vacio -> Text(stringResource(R.string.gasto_monto_ayuda), style = Tema.texto.chico.copy(fontSize = 14.sp), color = Tema.colores.ayuda, modifier = Modifier.padding(top = Tema.espacios.xs))
            // el renglón queda reservado aunque no diga nada: lo de abajo no salta al escribir el primer número
            else -> Text(" ", style = Tema.texto.chico.copy(fontSize = 14.sp), modifier = Modifier.padding(top = Tema.espacios.xs).clearAndSetSemantics {})
        }
        }
        // con un aviso ocupando el renglón y el teclado cerrado, igual se dice cómo volver a abrirlo
        if (!activo && (estado.centavosQuitados != null || avisoDelTope != null || error != null)) {
            Text(stringResource(if (vacio) R.string.gasto_tocar_para_escribir else R.string.gasto_tocar_para_editar), style = Tema.texto.chico.copy(fontSize = 14.sp), color = Tema.colores.apagado)
        }
    }
}

/** Para comparar lo escrito con las sugerencias sin mayúsculas ni tildes. */
private fun sinTildes(t: String) = java.text.Normalizer.normalize(t.lowercase(), java.text.Normalizer.Form.NFD).replace(Regex("\\p{Mn}"), "")

@Preview(widthDp = 390, heightDp = 844)
@Composable
private fun Vista() = TemaCuaderno {
    CargarGastoPantalla(
        CargarGastoEstado(
            cargando = false, monedas = listOf(Moneda("PYG", 0, "₲"), Moneda("BRL", 2, "R$")), nombresDeMoneda = mapOf("PYG" to "Guaraní", "BRL" to "Real"),
            moneda = "BRL", montoTexto = "137,50", categorias = listOf(OpcionDeCategoria("c1", "Comida", "🍽️"), OpcionDeCategoria("otro", "Otro", "📦")), categoria = "c1",
            diaImputado = "2027-02-18", hoy = "2027-02-18",
        ),
        AccionesDeCargarGasto(),
    )
}
