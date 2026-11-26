// La raíz de la interfaz: el tema y la navegación.
package com.eliasgonzalez.cuadernodegastos.ui

import androidx.compose.runtime.Composable
import com.eliasgonzalez.cuadernodegastos.ui.navegacion.Navegacion
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

@Composable
fun CuadernoDeGastos(viajeInicial: String?) = TemaCuaderno { Navegacion(viajeInicial) }
