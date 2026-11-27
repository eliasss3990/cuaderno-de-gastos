// Los diálogos de la app, con sus colores (no los de Material por defecto).
package com.eliasgonzalez.cuadernodegastos.ui.componentes.dialogos

import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.Modifier
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

/** Confirmar algo que se pierde (salir sin guardar): seguir a la derecha y la salida en rojo. */
@Composable
fun DialogoDeConfirmar(titulo: String, texto: String, seguir: String, salir: String, alSeguir: () -> Unit, alSalir: () -> Unit) {
    AlertDialog(
        onDismissRequest = alSeguir,
        // el mínimo de ancho de un diálogo (si no, con títulos cortos queda angosto)
        modifier = Modifier.widthIn(min = 280.dp),
        title = { Text(titulo) },
        text = { Text(texto) },
        confirmButton = { TextButton(onClick = alSeguir) { Text(seguir, color = Tema.colores.principal) } },
        dismissButton = { TextButton(onClick = alSalir) { Text(salir, color = Tema.colores.error) } },
        containerColor = Tema.colores.superficie,
        titleContentColor = Tema.colores.tinta,
        textContentColor = Tema.colores.dato,
    )
}
