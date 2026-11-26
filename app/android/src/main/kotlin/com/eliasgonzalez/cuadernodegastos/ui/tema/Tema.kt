// El tema de la app: las pantallas leen todo de `Tema` (Tema.colores.fondo, Tema.espacios.l…), nunca valores sueltos.
package com.eliasgonzalez.cuadernodegastos.ui.tema

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

private val LocalColores = staticCompositionLocalOf { Colores() }
private val LocalTipografia = staticCompositionLocalOf { Tipografia() }
private val LocalEspacios = staticCompositionLocalOf { Espacios() }
private val LocalMedidas = staticCompositionLocalOf { Medidas() }
private val LocalFormas = staticCompositionLocalOf { Formas() }

object Tema {
    val colores: Colores
        @Composable @ReadOnlyComposable get() = LocalColores.current
    val texto: Tipografia
        @Composable @ReadOnlyComposable get() = LocalTipografia.current
    val espacios: Espacios
        @Composable @ReadOnlyComposable get() = LocalEspacios.current
    val medidas: Medidas
        @Composable @ReadOnlyComposable get() = LocalMedidas.current
    val formas: Formas
        @Composable @ReadOnlyComposable get() = LocalFormas.current
}

@Composable
fun TemaCuaderno(contenido: @Composable () -> Unit) {
    val colores = Colores()
    val tipografia = Tipografia()
    // Material 3 se usa para piezas del sistema (campos, diálogos): con los mismos colores
    val esquema = lightColorScheme(
        primary = colores.principal,
        onPrimary = colores.superficie,
        background = colores.fondo,
        onBackground = colores.tinta,
        surface = colores.superficie,
        onSurface = colores.tinta,
        error = colores.error,
    )
    CompositionLocalProvider(LocalColores provides colores, LocalTipografia provides tipografia) {
        MaterialTheme(colorScheme = esquema) {
            CompositionLocalProvider(LocalTextStyle provides tipografia.cuerpo.copy(color = colores.tinta), content = contenido)
        }
    }
}
