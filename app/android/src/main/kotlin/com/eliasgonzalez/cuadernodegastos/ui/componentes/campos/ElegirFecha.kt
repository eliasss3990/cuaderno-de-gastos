// El calendario para elegir una fecha (AAAA-MM-DD), con "Borrar" para dejarla sin fecha.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.campos

import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.R
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.DisplayMode
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ElegirFecha(
    actual: String?,
    textoListo: String,
    textoBorrar: String?,
    alElegir: (String?) -> Unit,
    /** El último día que se puede elegir (AAAA-MM-DD), o null sin límite. */
    hasta: String? = null,
    /** La pregunta de arriba ("¿Qué día lo pagaste?"), o null para el título del sistema. */
    titulo: String? = null,
    alCerrar: () -> Unit,
) {
    val colores = DatePickerDefaults.colors(
        containerColor = Tema.colores.superficie,
        titleContentColor = Tema.colores.etiqueta,
        headlineContentColor = Tema.colores.tinta,
        weekdayContentColor = Tema.colores.etiqueta,
        dayContentColor = Tema.colores.tinta,
        selectedDayContainerColor = Tema.colores.principal,
        selectedDayContentColor = Tema.colores.superficie,
        todayContentColor = Tema.colores.principal,
        todayDateBorderColor = Tema.colores.principal,
        selectedYearContainerColor = Tema.colores.principal,
        dividerColor = Tema.colores.bordeDeCampo,
    )
    val boton = ButtonDefaults.textButtonColors(contentColor = Tema.colores.principal)
    // el calendario trabaja en UTC: el día elegido se lee en UTC para no correrse por la zona del celular
    val limite = hasta?.let { LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() }
    val estado = rememberDatePickerState(
        // un día inicial pasado el límite (el fin se acortó) no se puede elegir: arranca en el límite
        initialSelectedDateMillis = actual?.let { LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() }?.let { if (limite != null && it > limite) limite else it },
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long) = limite == null || utcTimeMillis <= limite
        },
    )
    DatePickerDialog(
        onDismissRequest = alCerrar,
        colors = colores,
        confirmButton = {
            TextButton(onClick = {
                alElegir(estado.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() })
                alCerrar()
            }, colors = boton) { Text(textoListo, color = Tema.colores.principal) }
        },
        // siempre se puede cancelar; sin texto para borrar, la fecha es obligatoria (no se ofrece dejarla vacía)
        dismissButton = {
            Row {
                textoBorrar?.let { texto ->
                    TextButton(onClick = {
                        alElegir(null)
                        alCerrar()
                    }, colors = boton) { Text(texto, color = Tema.colores.principal) }
                }
                TextButton(onClick = alCerrar, colors = boton) { Text(stringResource(R.string.cancelar), color = Tema.colores.principal) }
            }
        },
    ) {
        DatePicker(
            state = estado, colors = colores,
            title = titulo?.let { { Text(it, style = Tema.texto.etiqueta, color = Tema.colores.etiqueta, modifier = Modifier.padding(start = 24.dp, end = 12.dp, top = 16.dp)) } }
                ?: { DatePickerDefaults.DatePickerTitle(DisplayMode.Picker, Modifier.padding(start = 24.dp, end = 12.dp, top = 16.dp)) },
        )
    }
}
