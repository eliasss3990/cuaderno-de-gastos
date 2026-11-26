// La raíz de la interfaz: el tema y la navegación. El viaje con el que abrir se lee fuera del hilo principal.
package com.eliasgonzalez.cuadernodegastos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.eliasgonzalez.cuadernodegastos.CuadernoApp
import com.eliasgonzalez.cuadernodegastos.ui.navegacion.Navegacion
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Con qué viaje abrir (null: ninguno, va a la bienvenida). */
private class Inicio(val viaje: String?)

@Composable
fun CuadernoDeGastos() = TemaCuaderno {
    val app = LocalContext.current.applicationContext as CuadernoApp
    // abrir la base puede tardar (migraciones): mientras tanto, solo el fondo
    val inicio by produceState<Inicio?>(null) { value = withContext(Dispatchers.IO) { Inicio(app.sincronizacion.viajes().lastOrNull()) } }
    val listo = inicio
    if (listo == null) Box(Modifier.fillMaxSize().background(Tema.colores.fondo)) else Navegacion(listo.viaje)
}
