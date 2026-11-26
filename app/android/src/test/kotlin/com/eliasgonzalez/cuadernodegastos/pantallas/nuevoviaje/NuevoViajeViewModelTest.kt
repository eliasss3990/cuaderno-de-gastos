package com.eliasgonzalez.cuadernodegastos.pantallas.nuevoviaje

import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.red.MonedaNueva
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.red.Resultado
import com.eliasgonzalez.cuadernodegastos.viajes.AltaDeViaje
import com.eliasgonzalez.cuadernodegastos.viajes.PlanNuevo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NuevoViajeViewModelTest {
    private val hilo = UnconfinedTestDispatcher()
    private var respuesta: AltaDeViaje = AltaDeViaje.Lista("v1")
    private val creados = mutableListOf<Pair<PlanNuevo, Perfil>>()
    private val entradas = mutableListOf<String>()
    private lateinit var vm: NuevoViajeViewModel

    @Before
    fun antes() {
        Dispatchers.setMain(hilo)
        vm = NuevoViajeViewModel({ p, q -> creados += p to q; respuesta }, "Pixel 9", "America/Asuncion", { entradas += it }, hilo, { 1_802_971_920_000 })
    }

    @After
    fun despues() = Dispatchers.resetMain()

    private fun paso1() {
        vm.alCambiarNombre(" Brasil 2027 ")
        vm.alElegirInicio("2027-02-15")
        vm.alElegirFin("2027-02-28")
        vm.alCambiarApodo("Papá")
    }

    @Test
    fun arrancaConLaZonaDelCelularYLasDosMonedas() {
        val e = vm.estado.value
        assertEquals(1, e.paso)
        assertEquals("America/Asuncion", e.zona)
        assertEquals("Asunción", e.ciudad)
        assertEquals(listOf("PYG", "BRL"), e.monedas.filter { it.elegida }.map { it.moneda.codigo })
        assertEquals(listOf("Guaraní", "Real"), e.monedas.map { it.nombre })
        assertEquals(Arranque.SIN_SALIDA, e.arranque)
    }

    @Test
    fun elAvisoYLosDiasSalenDeLasFechas() {
        paso1()
        val e = vm.estado.value
        // hoy es 18 de febrero de 2027 (en Asunción): salir el 15 es que ya arrancó
        assertEquals(Arranque.YA_ARRANCO to "15 de febrero", e.arranque to e.salidaParaLeer)
        vm.alElegirInicio("2027-02-18")
        assertEquals(Arranque.HOY, vm.estado.value.arranque)
        vm.alElegirInicio("2027-03-01")
        assertEquals(Arranque.FALTA, vm.estado.value.arranque)
        vm.alElegirInicio("2027-02-15")
        assertEquals(14L, e.dias)
        // sin fecha de fin no hay días; volver a tocarla la recupera vacía
        vm.alCambiarSinFin()
        assertTrue(vm.estado.value.sinFechaFin)
        assertNull(vm.estado.value.fechaFin)
        assertNull(vm.estado.value.dias)
    }

    @Test
    fun paraSeguirMarcaTodoLoQueFaltaCadaUnoEnSuCampo() {
        vm.alCambiarMoneda("PYG")
        vm.alCambiarMoneda("BRL")
        vm.alElegirInicio("2027-02-15")
        vm.alElegirFin("2027-02-10")
        vm.alSeguir()
        // todos a la vez, no de a uno
        assertEquals(
            mapOf("nombre" to R.string.nuevo_falta_nombre, "monedas" to R.string.nuevo_falta_moneda, "apodo" to R.string.nuevo_falta_apodo, "fecha_fin" to R.string.nuevo_fechas_al_reves),
            vm.estado.value.errores,
        )
        assertEquals(1, vm.estado.value.paso)
        // al tocar un campo se va su error y los demás quedan
        vm.alCambiarNombre("V")
        assertEquals(setOf("monedas", "apodo", "fecha_fin"), vm.estado.value.errores.keys)
        vm.alCambiarMoneda("BRL")
        vm.alCambiarApodo("Eli")
        vm.alElegirFin("2027-02-15")
        assertEquals(emptyMap<String, Int>(), vm.estado.value.errores)
        vm.alSeguir()
        assertEquals(2, vm.estado.value.paso)
        // volver desde el 2 lleva al 1; desde el 1 la pantalla cierra
        assertTrue(vm.alVolver())
        assertEquals(1, vm.estado.value.paso)
        assertFalse(vm.alVolver())
    }

    @Test
    fun elTopeSeFormateaYDaElPromedioSugerido() {
        paso1()
        vm.alSeguir()
        vm.alCambiarTope("PYG", "10000000")
        vm.alCambiarTope("BRL", "5600,00")
        val e = vm.estado.value
        assertEquals("10.000.000", e.topes["PYG"])
        assertEquals("5.600,00", e.topes["BRL"])
        // 10.000.000 ÷ 14 = 714.285 (hacia abajo); 5.600,00 ÷ 14 = 400,00
        assertEquals(listOf("₲ 714.285" to "10.000.000 ÷ 14", "R$ 400,00" to "5.600,00 ÷ 14"), e.promedios.map { it.monto to it.cuenta })
    }

    @Test
    fun guardarCreaElViajeConTodoLoCargadoYEntra() {
        paso1()
        vm.alElegirEmoji(1)
        vm.alSeguir()
        vm.alCambiarTope("PYG", "10000000")
        vm.alCambiarEfectivo("BRL", "400")
        vm.alCambiarObjetivos(" Conocer las Cataratas ")
        vm.alGuardar()
        val (plan, perfil) = creados.single()
        assertEquals(
            PlanNuevo(
                "Brasil 2027", "America/Asuncion", listOf(MonedaNueva("PYG", 0, "₲"), MonedaNueva("BRL", 2, "R$")), "2027-02-15", "2027-02-28",
                mapOf("PYG" to 10_000_000L, "BRL" to null), mapOf("PYG" to null, "BRL" to 40_000L), "Conocer las Cataratas",
            ),
            plan,
        )
        assertEquals(Perfil("Pixel 9", "Papá", "#1F4E79", "🦊"), perfil)
        assertEquals(listOf("v1"), entradas)
    }

    @Test
    fun cadaResultadoTieneSuSalida() {
        paso1()
        vm.alSeguir()
        respuesta = AltaDeViaje.Fallo(Resultado.Incierto)
        vm.alGuardar()
        assertEquals(R.string.alta_incierta, vm.estado.value.mensaje)
        assertFalse(vm.estado.value.enviando)
        respuesta = AltaDeViaje.PlanInvalido("zona_horaria", "la zona horaria no existe")
        vm.alGuardar()
        assertEquals("la zona horaria no existe", vm.estado.value.problema)
        respuesta = AltaDeViaje.SinPlan("v2", PlanNuevo("x", "UTC", emptyList()))
        vm.alGuardar()
        assertEquals(R.string.nuevo_sin_plan, vm.estado.value.mensaje)
        assertEquals(listOf("v2"), entradas)
        // sin fecha de fin, el plan va sin ella aunque se haya elegido antes
        vm.alCambiarSinFin()
        respuesta = AltaDeViaje.Lista("v3")
        vm.alGuardar()
        assertNull(creados.last().first.fechaFin)
    }
}
