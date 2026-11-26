// Los emojis y colores para elegir cómo se ve cada integrante (los mismos al crear el viaje y al unirse).
package com.eliasgonzalez.cuadernodegastos.pantallas.comun

/** Un emoji con su fondo suave (el círculo del integrante). */
data class EmojiDePerfil(val emoji: String, val fondo: String)

object Perfiles {
    val emojis = listOf(
        EmojiDePerfil("🦁", "#FFE2B8"),
        EmojiDePerfil("🦊", "#FFD6CC"),
        EmojiDePerfil("🐢", "#D6EFD6"),
        EmojiDePerfil("🦜", "#D6E6FA"),
        EmojiDePerfil("🐼", "#E8E8E8"),
    )

    /** Los colores fuertes que se eligen debajo de los emojis. */
    val colores = listOf("#E8743B", "#1F4E79", "#2E7D32", "#8E44AD", "#C0392B")
}

/** "#RRGGBB" a un color de Compose (blanco si no se puede leer). */
fun colorDe(hex: String): androidx.compose.ui.graphics.Color =
    hex.removePrefix("#").toLongOrNull(16)?.let { androidx.compose.ui.graphics.Color(0xFF000000 or it) } ?: androidx.compose.ui.graphics.Color.White
