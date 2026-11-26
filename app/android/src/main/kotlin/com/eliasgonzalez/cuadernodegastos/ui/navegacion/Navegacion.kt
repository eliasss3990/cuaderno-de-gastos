// El grafo de navegación: solo conecta rutas con pantallas y les da sus dependencias; cada pantalla vive en su carpeta.
package com.eliasgonzalez.cuadernodegastos.ui.navegacion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.eliasgonzalez.cuadernodegastos.CuadernoApp
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Hoy
import com.eliasgonzalez.cuadernodegastos.pantallas.bienvenida.BienvenidaPantalla
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.AccionesDeHoy
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.HoyPantalla
import com.eliasgonzalez.cuadernodegastos.pantallas.hoy.HoyViewModel
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.AccionesDeNuevoViaje
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.NuevoViajePantalla
import com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje.NuevoViajeViewModel
import com.eliasgonzalez.cuadernodegastos.pantallas.unirse.AccionesDeUnirse
import com.eliasgonzalez.cuadernodegastos.pantallas.unirse.UnirsePantalla
import com.eliasgonzalez.cuadernodegastos.pantallas.unirse.UnirseViewModel
import kotlinx.coroutines.flow.map

/** `viajeInicial`: si ya hay un viaje en el celular, la app abre en su Hoy. */
@Composable
fun Navegacion(viajeInicial: String?) {
    val nav = rememberNavController()
    val app = LocalContext.current.applicationContext as CuadernoApp
    val celular = android.os.Build.MODEL
    NavHost(navController = nav, startDestination = viajeInicial?.let(Rutas::hoy) ?: Rutas.BIENVENIDA) {
        composable(Rutas.BIENVENIDA) {
            BienvenidaPantalla(alCrearViaje = { nav.navigate(Rutas.NUEVO_VIAJE) }, alTenerCodigo = { nav.navigate(Rutas.UNIRSE) })
        }
        composable(Rutas.NUEVO_VIAJE) {
            val vm = viewModel { NuevoViajeViewModel(app.viajes::crear, celular, java.time.ZoneId.systemDefault().id) }
            val e by vm.estado.collectAsState()
            LaunchedEffect(e.entrarA) { e.entrarA?.let { entrar(nav, it) } }
            NuevoViajePantalla(
                e,
                AccionesDeNuevoViaje(
                    alCerrar = { nav.popBackStack() },
                    alVolver = { if (!vm.alVolver()) nav.popBackStack() },
                    alCambiarNombre = vm::alCambiarNombre,
                    alElegirInicio = vm::alElegirInicio,
                    alElegirFin = vm::alElegirFin,
                    alCambiarSinFin = vm::alCambiarSinFin,
                    alCambiarMoneda = vm::alCambiarMoneda,
                    alCambiarApodo = vm::alCambiarApodo,
                    alElegirEmoji = vm::alElegirEmoji,
                    alSeguir = vm::alSeguir,
                    alCambiarTope = vm::alCambiarTope,
                    alCambiarEfectivo = vm::alCambiarEfectivo,
                    alCambiarObjetivos = vm::alCambiarObjetivos,
                    alGuardar = vm::alGuardar,
                ),
            )
        }
        composable(Rutas.UNIRSE) {
            val vm = viewModel { UnirseViewModel(app.viajes::unirse, celular) }
            val e by vm.estado.collectAsState()
            LaunchedEffect(e.entrarA) { e.entrarA?.let { entrar(nav, it) } }
            UnirsePantalla(e, AccionesDeUnirse(vm::alCambiarCodigo, vm::alCambiarApodo, vm::alElegirEmoji, vm::alUnirse, alVolver = { nav.popBackStack() }))
        }
        composable(Rutas.HOY) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel { HoyViewModel({ Hoy.resumen(s.lector(viaje), System.currentTimeMillis()) }, { s.pendientes(viaje) }, s.cambios, s.estados.map { it[viaje] }) }
            val e by vm.estado.collectAsState()
            HoyPantalla(e, AccionesDeHoy())
        }
    }
}

/** Entrar a un viaje: Hoy queda como la primera pantalla (atrás no vuelve a crear ni a unirse). */
private fun entrar(nav: NavHostController, viaje: String) {
    nav.navigate(Rutas.hoy(viaje)) { popUpTo(0) { inclusive = true } }
}
