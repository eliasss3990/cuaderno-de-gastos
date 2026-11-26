// Los estilos de texto de la app (Roboto; el texto de base es de 15 con interlineado de 1,3).
package com.eliasgonzalez.cuadernodegastos.ui.tema

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

private fun estilo(tamano: Int, peso: FontWeight = FontWeight.Normal) =
    TextStyle(fontSize = tamano.sp, fontWeight = peso, lineHeight = (tamano * 1.3).sp)

@Immutable
data class Tipografia(
    /** El texto de base. */
    val cuerpo: TextStyle = estilo(15),
    /** Textos secundarios chicos. */
    val chico: TextStyle = estilo(12),
    /** Los montos grandes. */
    val grande: TextStyle = estilo(26, FontWeight.Bold),
    /** El nombre de la app en la bienvenida. */
    val portada: TextStyle = estilo(30, FontWeight.Bold),
    /** La bajada de la bienvenida. */
    val bajada: TextStyle = estilo(16),
    /** El título de una pantalla. */
    val tituloDeBarra: TextStyle = estilo(20, FontWeight.SemiBold),
    /** El título de una tarjeta o sección (en minúscula normal). */
    val tituloDeTarjeta: TextStyle = estilo(15, FontWeight.SemiBold),
    /** Una línea de contexto en mayúsculas chicas (la fecha de hoy, el título de una lista). */
    val rotulo: TextStyle = estilo(12, FontWeight.Bold).copy(letterSpacing = 0.05.em),
    /** El texto de los botones. */
    val boton: TextStyle = estilo(17, FontWeight.Bold),
    /** La etiqueta de un campo (en minúscula normal: se lee más rápido que en mayúsculas). */
    val etiqueta: TextStyle = estilo(13, FontWeight.Medium),
    /** Lo que se escribe en un campo. */
    val valorDeCampo: TextStyle = estilo(15),
    /** Un error debajo de su campo. */
    val error: TextStyle = estilo(14),
    /** El título de una fila de la lista. */
    val fuerte: TextStyle = estilo(15, FontWeight.Bold),
    /** El monto de una fila. */
    val monto: TextStyle = estilo(16, FontWeight.Bold),
    /** Los chips. */
    val chip: TextStyle = estilo(13),
    /** El indicador de sincronización. */
    val estadoDeSincronizacion: TextStyle = estilo(12, FontWeight.SemiBold),
    /** La barra de abajo. */
    val navegacion: TextStyle = estilo(12),
    /** El botón de cargar gasto. */
    val botonFlotante: TextStyle = estilo(19, FontWeight.Bold),
    /** Los avisos. */
    val aviso: TextStyle = estilo(14),
)
