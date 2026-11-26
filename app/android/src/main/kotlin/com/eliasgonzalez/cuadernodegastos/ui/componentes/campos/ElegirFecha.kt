// El calendario para elegir una fecha (AAAA-MM-DD), con "Borrar" para dejarla sin fecha.
package com.eliasgonzalez.cuadernodegastos.ui.componentes.campos

import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ElegirFecha(actual: String?, textoListo: String, textoBorrar: String, alElegir: (String?) -> Unit, alCerrar: () -> Unit) {
    // el calendario trabaja en UTC: el día elegido se lee en UTC para no correrse por la zona del celular
    val estado = rememberDatePickerState(initialSelectedDateMillis = actual?.let { LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() })
    DatePickerDialog(
        onDismissRequest = alCerrar,
        confirmButton = {
            TextButton(onClick = {
                alElegir(estado.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() })
                alCerrar()
            }) { Text(textoListo) }
        },
        dismissButton = {
            TextButton(onClick = {
                alElegir(null)
                alCerrar()
            }) { Text(textoBorrar) }
        },
    ) { DatePicker(state = estado) }
}
