// Los diálogos de la app, con sus colores (no los de Material por defecto).
package com.eliasgonzalez.cuadernodegastos.ui.componentes.dialogos

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
        title = { Text(titulo) },
        text = { Text(texto) },
        confirmButton = { TextButton(onClick = alSeguir) { Text(seguir, color = Tema.colores.principal) } },
        dismissButton = { TextButton(onClick = alSalir) { Text(salir, color = Tema.colores.error) } },
        containerColor = Tema.colores.superficie,
        titleContentColor = Tema.colores.tinta,
        textContentColor = Tema.colores.dato,
    )
}
