// Los colores de la app. Ninguna pantalla usa un color suelto.
package com.eliasgonzalez.cuadernodegastos.ui.tema

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

@Immutable
data class Colores(
    /** El fondo de todas las pantallas. */
    val fondo: Color = Color(0xFFFBF7EE),
    /** Tarjetas, campos y hojas. */
    val superficie: Color = Color(0xFFFFFFFF),
    /** El texto principal. */
    val tinta: Color = Color(0xFF1B2A41),
    /** El texto secundario. */
    val apagado: Color = Color(0xFF6B7280),
    /** La etiqueta de un campo: más oscura que el texto secundario, para que se lea antes que el dato. */
    val etiqueta: Color = Color(0xFF4B5563),
    /** Lo cargado en un campo: oscuro pero sin el peso de los títulos. */
    val dato: Color = Color(0xFF374151),
    /** El texto de ayuda de un campo vacío. */
    val ayuda: Color = Color(0xFF6B7280),
    /** La acción principal y su fondo suave. */
    val principal: Color = Color(0xFF1F4E79),
    val principalSuave: Color = Color(0xFFDCE8F4),
    /** El botón de cargar gasto. */
    /** El botón de cargar. */
    val acento: Color = Color(0xFFC8561F),
    val acentoSuave: Color = Color(0xFFFCE6DA),
    /** Bien, aviso y error, cada uno con su fondo suave. */
    val bien: Color = Color(0xFF256528),
    val bienSuave: Color = Color(0xFFE3F1E4),
    val aviso: Color = Color(0xFF9A5B00),
    val avisoSuave: Color = Color(0xFFFFF0D2),
    val error: Color = Color(0xFFB3261E),
    val errorSuave: Color = Color(0xFFFBE3E1),
    /** El texto de los avisos informativos (sobre el fondo suave de la acción principal). */
    val tintaDelAviso: Color = Color(0xFF12334F),
    /** Bordes y separadores. */
    val linea: Color = Color(0xFFE7E0CF),
    /** El borde de lo que se toca o se escribe (campos, chips). */
    val bordeDeCampo: Color = Color(0xFF847D70),
    /** El fondo de las barras de progreso y de los selectores. */
    val pista: Color = Color(0xFFEEE8D8),
    /** Cada moneda con su color en los montos. */
    val guaranies: Color = Color(0xFFB3261E),
    val reales: Color = Color(0xFF1B7F3B),
    /** La escala del presupuesto: de verde a amarillo hasta el 79 %, rojo desde el 80 %, violeta al pasarse. */
    val escalaVerde: Color = Color(0xFF2A8A45),
    val escalaAmarilla: Color = Color(0xFF9C7A00),
    val escalaRoja: Color = Color(0xFFD32F2F),
    val escalaSuperada: Color = Color(0xFF5B2A86),
)
