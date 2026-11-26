// La única actividad: arranca la interfaz y nada más (pantallas, navegación y tema viven en `ui/` y `pantallas/`).
package com.eliasgonzalez.cuadernodegastos

import android.os.Bundle
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.eliasgonzalez.cuadernodegastos.ui.CuadernoDeGastos

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val claras = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = claras, navigationBarStyle = claras)
        // el viaje con el que abrir: leerlo toca la base, que no se abre en el hilo principal
        val viaje = java.util.concurrent.Executors.newSingleThreadExecutor().submit<String?> { (application as CuadernoApp).sincronizacion.viajes().lastOrNull() }.get()
        setContent { CuadernoDeGastos(viaje) }
    }
}
