// Los datos que no hacen falta para guardar: el día al que cuenta, el concepto, el alias de la tarjeta y la nota.
package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.partes

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.Text
import com.eliasgonzalez.cuadernodegastos.ui.componentes.estado.ChipDeAccion
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.AccionesDeCargarGasto
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.CORTO
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.CargarGastoEstado
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.LARGO
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.Formatos
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.CampoDeTexto
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.CampoParaElegir
import com.eliasgonzalez.cuadernodegastos.ui.componentes.campos.ElegirFecha

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MasDatos(estado: CargarGastoEstado, acciones: AccionesDeCargarGasto) {
    var eligiendoDia by rememberSaveable { mutableStateOf(false) }
    val ayer = runCatching { java.time.LocalDate.parse(estado.hoy).minusDays(1).toString() }.getOrNull()
    val dia = Formatos.fechaLarga(estado.diaImputado) + when (estado.diaImputado) {
        estado.hoy -> " " + stringResource(R.string.gasto_hoy_entre_parentesis)
        ayer -> " " + stringResource(R.string.gasto_ayer_entre_parentesis)
        else -> ""
    }
    // la ayuda pegada al día (es de ese campo, no del siguiente)
    androidx.compose.foundation.layout.Column(verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(Tema.espacios.xs)) {
        CampoParaElegir(
            stringResource(R.string.gasto_dia), dia, { eligiendoDia = true },
            icono = Icons.Outlined.DateRange,
        )
        Text(stringResource(R.string.gasto_dia_ayuda), style = Tema.texto.chico.copy(fontSize = 14.sp), color = Tema.colores.apagado)
    }
    CampoDeTexto(stringResource(R.string.gasto_concepto), estado.concepto, acciones.alCambiarConcepto, ayuda = stringResource(R.string.gasto_concepto_ayuda), accion = ImeAction.Next, largoMaximo = CORTO)
    if (estado.conTarjeta) {
        CampoDeTexto(stringResource(R.string.gasto_alias), estado.alias, acciones.alCambiarAlias, ayuda = stringResource(R.string.gasto_alias_ayuda), mayusculas = true, accion = ImeAction.Next, largoMaximo = CORTO)
        // las tarjetas ya usadas, para no escribirlas de nuevo
        if (estado.sugerenciasDeAlias.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Tema.espacios.s)) { for (a in estado.sugerenciasDeAlias) ChipDeAccion(a, { acciones.alCambiarAlias(a) }) }
        }
    }
    CampoDeTexto(stringResource(R.string.gasto_nota), estado.nota, acciones.alCambiarNota, ayuda = stringResource(R.string.gasto_nota_ayuda), unaLinea = false, lineasMinimas = 2, accion = ImeAction.Default, largoMaximo = LARGO)
    if (eligiendoDia) {
        ElegirFecha(estado.diaImputado, stringResource(R.string.listo), null, { it?.let(acciones.alElegirDia) }, hasta = estado.finDelViaje, titulo = stringResource(R.string.gasto_dia_pregunta)) { eligiendoDia = false }
    }
}
