// El grafo de navegación: solo conecta rutas con pantallas y les da sus dependencias; cada pantalla vive en su carpeta.
package com.eliasgonzalez.cuadernodegastos.ui.navegacion

import com.eliasgonzalez.cuadernodegastos.pantallas.gastos.GastosEstado
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.fadeIn
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.EnterTransition
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.activity.compose.BackHandler
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.AvisosViewModel
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.AvisoDeGastos
import com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto.DetalleViewModel
import com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto.DetallePantalla
import com.eliasgonzalez.cuadernodegastos.pantallas.detallegasto.AccionesDeDetalle
import com.eliasgonzalez.cuadernodegastos.pantallas.gastos.GastosViewModel
import com.eliasgonzalez.cuadernodegastos.pantallas.gastos.GastosPantalla
import com.eliasgonzalez.cuadernodegastos.pantallas.gastos.AccionesDeGastos
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.GastoGuardado
import com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto.CargarGastoEstado
import com.eliasgonzalez.cuadernodegastos.pantallas.comun.ControlDeAvisos
import kotlinx.coroutines.delay
import com.eliasgonzalez.cuadernodegastos.R
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
    // un solo aviso para toda la app: lo ven Hoy y Gastos (no se pierde al pasar de una a otra)
    val avisos = viewModel {
        AvisosViewModel(
            deshacerAlta = { viaje, id -> app.sincronizacion.registrar(viaje) { sinc -> CargaDeGastos.deshacerAlta(id, Ids.nuevo(), sinc.nuevaMarca()) } },
            restaurar = { viaje, id -> app.sincronizacion.registrar(viaje) { sinc -> CargaDeGastos.restaurar(id, Ids.nuevo(), sinc.nuevaMarca()) } },
            duracion = duracionDelAviso(accesibilidad),
        )
    }
    val aviso by avisos.aviso.collectAsState()
    // la pestaña de Gastos (del viaje o preparación) se recuerda aunque se vaya a Hoy y se vuelva
    var pestanaDeGastos by rememberSaveable { mutableIntStateOf(0) }
    // lo último que mostró Gastos (con su viaje), para no volver a verla vacía al entrar
    var ultimaListaDeGastos by remember { mutableStateOf(GastosEstado() to "") }
    // entre pantallas, "fade through": la que sale se va rápido y recién después entra la otra (no se leen encimadas)
    NavHost(
        navController = nav, startDestination = viajeInicial?.let(Rutas::hoy) ?: Rutas.BIENVENIDA,
        enterTransition = { entra() }, exitTransition = { sale() },
        popEnterTransition = { entra() }, popExitTransition = { sale() },
    ) {
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
        // entre las pestañas de la barra (Hoy y Gastos) no hay fundido: la barra queda quieta
        // sin animación solo hacia y desde Gastos; al resto, el fundido común (si no, lo que entra queda encima de Hoy)
        composable(
            Rutas.HOY,
            enterTransition = { if (initialState.destination.route == Rutas.GASTOS) EnterTransition.None else entra() },
            exitTransition = { if (targetState.destination.route == Rutas.GASTOS) ExitTransition.None else sale() },
            popEnterTransition = { if (initialState.destination.route == Rutas.GASTOS) EnterTransition.None else entra() },
        ) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel {
                HoyViewModel(
                    { Hoy.resumen(s.lector(viaje), System.currentTimeMillis()) }, { s.pendientes(viaje) }, s.cambios, s.estados.map { it[viaje] },
                )
            }
            val e by vm.estado.collectAsState()
            HoyPantalla(
                e,
                AccionesDeHoy(
                    alCargarGasto = { if (nav.currentDestination?.route == Rutas.HOY) nav.navigate(Rutas.cargarGasto(viaje)) },
                    alDeshacerGasto = avisos::alDeshacer,
                    alAbrirGasto = { id -> if (nav.currentDestination?.route == Rutas.HOY) nav.navigate(Rutas.detalle(viaje, id)) },
                    alIrA = { p -> if (p == 1 && nav.currentDestination?.route == Rutas.HOY) nav.navigate(Rutas.gastos(viaje)) { launchSingleTop = true } },
                ),
                aviso,
            )
        }
        composable(Rutas.GASTOS, enterTransition = { EnterTransition.None }, popExitTransition = { ExitTransition.None }) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel {
                GastosViewModel(
                    { s.lector(viaje) }, { s.pendientes(viaje) }, s.cambios, s.estados.map { it[viaje] },
                    // arranca con lo último que se vio (Gastos se rearma en cada visita: así no aparece vacía)
                    inicial = ultimaListaDeGastos.takeIf { it.second == viaje }?.first ?: GastosEstado(),
                )
            }
            val e by vm.estado.collectAsState()
            // solo una lista buena (un error de lectura no reemplaza lo último que se vio)
            LaunchedEffect(e) { if (!e.cargando && !e.noSePudoLeer) ultimaListaDeGastos = e to viaje }
            GastosPantalla(
                e, pestanaDeGastos,
                AccionesDeGastos(
                    alElegirPestana = { pestanaDeGastos = it },
                    alAbrirGasto = { id -> if (nav.currentDestination?.route == Rutas.GASTOS) nav.navigate(Rutas.detalle(viaje, id)) },
                    alCargarGasto = { if (nav.currentDestination?.route == Rutas.GASTOS) nav.navigate(Rutas.cargarGasto(viaje)) },
                    // Hoy queda siempre debajo: volver a Hoy es sacar Gastos
                    alIrA = { p -> if (p == 0) salirDe(nav, Rutas.GASTOS) },
                    alDeshacer = avisos::alDeshacer,
                ),
                aviso,
            )
        }
        composable(Rutas.DETALLE) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val gasto = entrada.arguments?.getString("gasto").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel {
                DetalleViewModel(
                    { s.lector(viaje) }, gasto, s.cambios,
                    aLaPapelera = { id -> s.registrar(viaje) { sinc -> CargaDeGastos.aLaPapelera(id, Ids.nuevo(), sinc.nuevaMarca()) } },
                    restaurar = { id -> s.registrar(viaje) { sinc -> CargaDeGastos.restaurar(id, Ids.nuevo(), sinc.nuevaMarca()) } },
                )
            }
            val e by vm.estado.collectAsState()
            val accion by vm.accion.collectAsState()
            val enviando = accion.ocupada
            val fallo by vm.fallo.collectAsState()
            val enviado by vm.enviado.collectAsState()
            // mandado a la papelera: vuelve y la pantalla de abajo avisa con deshacer
            LaunchedEffect(enviado) {
                enviado?.let { (id, monto) ->
                    if (nav.currentDestination?.route == Rutas.DETALLE) {
                        avisos.mostrar(viaje, AvisoDeGastos.EnPapelera(id, monto))
                        nav.popBackStack()
                    }
                }
            }
            // volvió de editar con cambios: se avisa un rato (la marca se borra al leerla: no reaparece)
            val marca by entrada.savedStateHandle.getStateFlow(CAMBIOS_GUARDADOS, false).collectAsState()
            var cambios by rememberSaveable { mutableStateOf(false) }
            // la marca se borra al leerla; la espera va en otro efecto (borrar la marca no la corta)
            LaunchedEffect(marca) {
                if (marca) {
                    entrada.savedStateHandle[CAMBIOS_GUARDADOS] = false
                    cambios = true
                }
            }
            LaunchedEffect(cambios) {
                if (cambios) {
                    delay(duracionDelAviso(accesibilidad))
                    cambios = false
                }
            }
            BackHandler(enabled = enviando) {}
            DetallePantalla(
                e,
                AccionesDeDetalle(
                    // mientras se manda a la papelera no se sale (si no, se perdería el aviso con deshacer)
                    alVolver = { if (!enviando) salirDe(nav, Rutas.DETALLE) },
                    alEditar = { if (nav.currentDestination?.route == Rutas.DETALLE) nav.navigate(Rutas.editar(viaje, gasto)) },
                    alEnviarAPapelera = vm::alEnviarAPapelera,
                    alRestaurar = vm::alRestaurar,
                ),
                accion = accion, fallo = fallo,
                aviso = if (cambios) stringResource(R.string.detalle_cambios_guardados) else null,
            )
        }
        composable(Rutas.CARGAR_GASTO) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel {
                CargarGastoViewModel(
                    lector = { s.lector(viaje) },
                    yo = { s.credenciales(viaje)?.integrante },
                    registrar = { _, _, _, operacion -> s.registrar(viaje) { sinc -> operacion(sinc.nuevaMarca()) } },
                    ahoraMs = { s.ahora(viaje) },
                )
            }
            val e by vm.estado.collectAsState()
            FormularioDeGasto(e, vm, alCerrar = { salirDe(nav, Rutas.CARGAR_GASTO) }) { g ->
                // la pantalla de abajo (Hoy o Gastos) muestra el aviso con deshacer; solo si todavía está acá
                if (nav.currentDestination?.route == Rutas.CARGAR_GASTO) {
                    avisos.mostrar(viaje, AvisoDeGastos.Guardado(g.id, g.monto, g.otroDia))
                    nav.popBackStack()
                }
            }
        }
        composable(Rutas.EDITAR) { entrada ->
            val viaje = entrada.arguments?.getString("viaje").orEmpty()
            val gasto = entrada.arguments?.getString("gasto").orEmpty()
            val s = app.sincronizacion
            val vm = viewModel {
                CargarGastoViewModel(
                    lector = { s.lector(viaje) },
                    yo = { s.credenciales(viaje)?.integrante },
                    // lo que cambió lo arma el ViewModel contra lo que se vio al abrir
                    registrar = { _, _, _, operacion -> s.registrar(viaje) { sinc -> operacion(sinc.nuevaMarca()) } },
                    ahoraMs = { s.ahora(viaje) },
                    editar = gasto,
                )
            }
            val e by vm.estado.collectAsState()
            FormularioDeGasto(e, vm, alCerrar = { salirDe(nav, Rutas.EDITAR) }) {
                if (nav.currentDestination?.route == Rutas.EDITAR) {
                    nav.previousBackStackEntry?.savedStateHandle?.set(CAMBIOS_GUARDADOS, true)
                    nav.popBackStack()
                }
            }
        }
    }
}

/** Cargar o editar: la misma pantalla con las acciones del ViewModel. */
@Composable
private fun FormularioDeGasto(e: CargarGastoEstado, vm: CargarGastoViewModel, alCerrar: () -> Unit, alGuardado: (GastoGuardado) -> Unit) {
    CargarGastoPantalla(
        e,
        AccionesDeCargarGasto(
            alCerrar = alCerrar,
            alGuardado = alGuardado,
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

/** 4 s, o más si la accesibilidad del celular lo pide (antes de Android 10 no hay duración recomendada). */
private fun duracionDelAviso(accesibilidad: AccessibilityManager): Long =
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
        accesibilidad.getRecommendedTimeoutMillis(
            ControlDeAvisos.DURACION.toInt(),
            AccessibilityManager.FLAG_CONTENT_ICONS or AccessibilityManager.FLAG_CONTENT_TEXT or AccessibilityManager.FLAG_CONTENT_CONTROLS,
        ).toLong()
    } else {
        ControlDeAvisos.DURACION
    }

/** El detalle sabe por acá que volvió de editar con cambios. */
private const val CAMBIOS_GUARDADOS = "cambios_guardados"

/** Sale de [ruta] solo si es la de arriba: un segundo toque durante la transición no saca también la de abajo. */
private fun salirDe(nav: NavHostController, ruta: String) {
    if (nav.currentDestination?.route == ruta) nav.popBackStack()
}

/** Entrar a un viaje: Hoy queda como la primera pantalla (atrás no vuelve a crear ni a unirse). */
private fun entrar(nav: NavHostController, viaje: String) {
    nav.navigate(Rutas.hoy(viaje)) { popUpTo(nav.graph.id) { inclusive = true } }
}

/** "Fade through": la pantalla que sale se va rápido y recién después entra la otra (nunca se leen encimadas). */
private fun entra() = fadeIn(tween(210, delayMillis = 90))

private fun sale() = fadeOut(tween(90))
