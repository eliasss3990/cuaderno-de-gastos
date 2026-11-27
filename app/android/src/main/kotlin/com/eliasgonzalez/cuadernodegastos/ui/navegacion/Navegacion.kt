// El grafo de navegación: solo conecta rutas con pantallas y les da sus dependencias; cada pantalla vive en su carpeta.
package com.eliasgonzalez.cuadernodegastos.ui.navegacion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import android.view.accessibility.AccessibilityManager
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.eliasgonzalez.cuadernodegastos.CuadernoApp
import com.eliasgonzalez.cuadernodegastos.dominio.base.Ids
import com.eliasgonzalez.cuadernodegastos.dominio.gastos.CargaDeGastos
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.Hoy
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.AccionesDeCargarGasto
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.CargarGastoPantalla
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.CargarGastoViewModel
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
    val accesibilidad = LocalContext.current.getSystemService(AccessibilityManager::class.java)
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
                    alCerrar = { salirDe(nav, Rutas.NUEVO_VIAJE) },
                    alVolver = { if (!vm.alVolver()) salirDe(nav, Rutas.NUEVO_VIAJE) },
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
            UnirsePantalla(e, AccionesDeUnirse(vm::alCambiarCodigo, vm::alCambiarApodo, vm::alElegirEmoji, vm::alUnirse, alVolver = { salirDe(nav, Rutas.UNIRSE) }))
        }
        composable(Rutas.HOY) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel {
                HoyViewModel(
                    { Hoy.resumen(s.lector(viaje), System.currentTimeMillis()) }, { s.pendientes(viaje) }, s.cambios, s.estados.map { it[viaje] },
                    deshacerAlta = { id -> s.registrar(viaje) { sinc -> CargaDeGastos.deshacerAlta(id, Ids.nuevo(), sinc.nuevaMarca()) } },
                    // antes de Android 10 no hay duración recomendada: queda la de siempre
                    duracionDelAviso = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                        accesibilidad.getRecommendedTimeoutMillis(
                            HoyViewModel.DURACION_DEL_AVISO.toInt(),
                            AccessibilityManager.FLAG_CONTENT_ICONS or AccessibilityManager.FLAG_CONTENT_TEXT or AccessibilityManager.FLAG_CONTENT_CONTROLS,
                        ).toLong()
                    } else {
                        HoyViewModel.DURACION_DEL_AVISO
                    },
                )
            }
            val e by vm.estado.collectAsState()
            val aviso by vm.aviso.collectAsState()
            // lo que avisa cargar gasto se le pasa al ViewModel una sola vez y se borra (no reaparece al volver ni al girar)
            val guardado by entrada.savedStateHandle.getStateFlow<String?>(GASTO_GUARDADO, null).collectAsState()
            LaunchedEffect(guardado) {
                guardado?.let {
                    vm.alGuardarGasto(it, entrada.savedStateHandle[GASTO_MONTO] ?: "", entrada.savedStateHandle[GASTO_DIA])
                    entrada.savedStateHandle[GASTO_GUARDADO] = null
                }
            }
            HoyPantalla(e, AccionesDeHoy(alCargarGasto = { if (nav.currentDestination?.route == Rutas.HOY) nav.navigate(Rutas.cargarGasto(viaje)) }, alDeshacerGasto = vm::alDeshacer), aviso)
        }
        composable(Rutas.CARGAR_GASTO) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel {
                CargarGastoViewModel(
                    lector = { s.lector(viaje) },
                    yo = { s.credenciales(viaje)?.integrante },
                    registrar = { b, id, op -> s.registrar(viaje) { sinc -> CargaDeGastos.alta(b, op, id, sinc.nuevaMarca()) } },
                    ahoraMs = { s.ahora(viaje) },
                )
            }
            val e by vm.estado.collectAsState()
            CargarGastoPantalla(
                e,
                AccionesDeCargarGasto(
                    alCerrar = { salirDe(nav, Rutas.CARGAR_GASTO) },
                    // Hoy muestra el aviso con deshacer
                    alGuardado = { g ->
                        // solo si todavía está en esta pantalla (una recomposición no debe sacar también Hoy)
                        if (nav.currentDestination?.route == Rutas.CARGAR_GASTO) {
                            nav.previousBackStackEntry?.savedStateHandle?.let { h ->
                                h[GASTO_MONTO] = g.monto
                                h[GASTO_DIA] = g.otroDia
                                h[GASTO_GUARDADO] = g.id
                            }
                            nav.popBackStack()
                        }
                    },
                    alTocarTecla = vm::alTocarTecla,
                    alBorrar = vm::alBorrar,
                    alBorrarTodo = vm::alBorrarTodo,
                    alElegirMoneda = vm::alElegirMoneda,
                    alElegirCategoria = vm::alElegirCategoria,
                    alElegirMetodo = vm::alElegirMetodo,
                    alCambiarLugar = vm::alCambiarLugar,
                    alCambiarConcepto = vm::alCambiarConcepto,
                    alCambiarAlias = vm::alCambiarAlias,
                    alCambiarNota = vm::alCambiarNota,
                    alElegirDia = vm::alElegirDia,
                    alMostrarMas = vm::alMostrarMas,
                    alGuardar = vm::alGuardar,
                ),
            )
        }
    }
}

/** La clave con que cargar gasto le avisa a Hoy qué se guardó ("id|₲ 150.005"). */
private const val GASTO_GUARDADO = "gasto_guardado"
private const val GASTO_MONTO = "gasto_monto"
private const val GASTO_DIA = "gasto_dia"

/** Sale de [ruta] solo si es la de arriba: un segundo toque durante la transición no saca también la de abajo. */
private fun salirDe(nav: NavHostController, ruta: String) {
    if (nav.currentDestination?.route == ruta) nav.popBackStack()
}

/** Entrar a un viaje: Hoy queda como la primera pantalla (atrás no vuelve a crear ni a unirse). */
private fun entrar(nav: NavHostController, viaje: String) {
    nav.navigate(Rutas.hoy(viaje)) { popUpTo(nav.graph.id) { inclusive = true } }
}
