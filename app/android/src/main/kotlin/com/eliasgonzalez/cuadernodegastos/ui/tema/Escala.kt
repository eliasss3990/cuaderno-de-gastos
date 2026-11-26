// El color de una barra del presupuesto: de verde a amarillo hasta el 79 %, rojo desde el 80 %, violeta al pasarse.
package com.eliasgonzalez.cuadernodegastos.ui.tema

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Nivel

@Composable
fun colorDeLaEscala(nivel: Nivel, porcentaje: Long): Color = when (nivel) {
    Nivel.BIEN -> lerp(Tema.colores.escalaVerde, Tema.colores.escalaAmarilla, (porcentaje.coerceIn(0, 79) / 79f))
    Nivel.CERCA -> Tema.colores.escalaRoja
    Nivel.SUPERADO -> Tema.colores.escalaSuperada
}
