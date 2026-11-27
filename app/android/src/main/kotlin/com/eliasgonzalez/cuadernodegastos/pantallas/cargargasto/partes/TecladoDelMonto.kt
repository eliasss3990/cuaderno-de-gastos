// El teclado del monto: dígitos, coma (solo si la moneda tiene decimales) y borrar, con teclas grandes.
package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.partes

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.material3.ripple
import androidx.compose.runtime.remember
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema

private val altoDeTecla = 56.dp

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TecladoDelMonto(conComa: Boolean, alTocar: (Char) -> Unit, alBorrar: () -> Unit, alBorrarTodo: () -> Unit, alCerrar: () -> Unit) {
    // una vibración corta confirma cada tecla (como el teclado del sistema); más marcada al borrar todo
    val vibrar = LocalHapticFeedback.current
    Column(
        Modifier.fillMaxWidth().background(Tema.colores.pista).padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // la flecha para cerrarlo, arriba a la derecha (como en los teclados del sistema): lejos de los números
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            IconButton(onClick = alCerrar, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Filled.KeyboardArrowDown, contentDescription = stringResource(R.string.gasto_cerrar_teclado), tint = Tema.colores.tinta)
            }
        }
        for (fila in listOf("123", "456", "789")) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { for (c in fila) Tecla(c.toString(), Modifier.weight(1f)) { vibrar.performHapticFeedback(HapticFeedbackType.TextHandleMove); alTocar(c) } }
        }
        val borrar = stringResource(R.string.gasto_borrar_digito)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (conComa) Tecla(",", Modifier.weight(1f), suave = true) { vibrar.performHapticFeedback(HapticFeedbackType.TextHandleMove); alTocar(',') } else Spacer(Modifier.weight(1f))
            Tecla("0", Modifier.weight(1f)) { vibrar.performHapticFeedback(HapticFeedbackType.TextHandleMove); alTocar('0') }
            val fuenteDeBorrar = remember { MutableInteractionSource() }
            val borrando by fuenteDeBorrar.collectIsPressedAsState()
            Box(
                Modifier.weight(1f).heightIn(min = altoDeTecla).clip(RoundedCornerShape(12.dp))
                    .background(if (borrando) Tema.colores.principalSuave else Tema.colores.linea)
                    .border(1.dp, if (borrando) Tema.colores.principal else Tema.colores.bordeDeCampo, RoundedCornerShape(12.dp))
                    .combinedClickable(role = Role.Button, interactionSource = fuenteDeBorrar, indication = ripple(color = Tema.colores.principal), onClick = { vibrar.performHapticFeedback(HapticFeedbackType.TextHandleMove); alBorrar() }, onLongClick = { vibrar.performHapticFeedback(HapticFeedbackType.LongPress); alBorrarTodo() }).semantics { contentDescription = borrar },
                contentAlignment = Alignment.Center,
            ) { Text("⌫", fontSize = 26.sp, color = Tema.colores.tinta, modifier = Modifier.clearAndSetSemantics {}) }
        }
    }
}

@Composable
private fun Tecla(texto: String, modifier: Modifier, suave: Boolean = false, alTocar: () -> Unit) {
    // mientras se aprieta, la tecla se tiñe (se ve aunque haya sol); la coma se ve como un número (funciona igual)
    val fuente = remember { MutableInteractionSource() }
    val apretada by fuente.collectIsPressedAsState()
    Box(
        modifier.heightIn(min = altoDeTecla).clip(RoundedCornerShape(12.dp))
            .background(if (apretada) Tema.colores.principalSuave else Tema.colores.superficie)
            .border(1.dp, if (apretada) Tema.colores.principal else Tema.colores.bordeDeCampo, RoundedCornerShape(12.dp))
            .clickable(role = Role.Button, interactionSource = fuente, indication = ripple(color = Tema.colores.principal), onClick = alTocar),
        contentAlignment = Alignment.Center,
    ) { Text(texto, fontSize = 26.sp, color = Tema.colores.tinta) }
}
