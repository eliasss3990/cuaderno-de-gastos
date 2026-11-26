package com.eliasgonzalez.cuadernodegastos.pantallas.unirse

import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.red.Rechazo
import com.eliasgonzalez.cuadernodegastos.red.Resultado
import com.eliasgonzalez.cuadernodegastos.viajes.AltaDeViaje
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class UnirseViewModelTest {
    private val hilo = UnconfinedTestDispatcher()
    private var respuesta: AltaDeViaje = AltaDeViaje.Lista("v1")
    private val pedidos = mutableListOf<Pair<String, Perfil>>()
    private val entradas = mutableListOf<String>()
    private lateinit var vm: UnirseViewModel

    @Before
    fun antes() {
        Dispatchers.setMain(hilo)
        vm = UnirseViewModel({ c, p -> pedidos += c to p; respuesta }, "Pixel 9", { entradas += it }, hilo)
    }

    @After
    fun despues() = Dispatchers.resetMain()

    private fun cargar() {
        vm.alCambiarCodigo("k7m4-9xq2")
        vm.alCambiarApodo("  Lu ")
        vm.alElegirEmoji(3)
    }

    @Test
    fun conTodoCargadoSeUneConElPerfilElegidoYEntraAlViaje() {
        cargar()
        vm.alUnirse()
        // el código en mayúsculas y el color que va con el emoji (el 3 de la lista)
        assertEquals(listOf("K7M4-9XQ2" to Perfil("Pixel 9", "Lu", com.eliasgonzalez.cuadernodegastos.pantallas.comun.Perfiles.colores[3], "🦜")), pedidos)
        assertEquals(listOf("v1"), entradas)
    }

    @Test
    fun sinCodigoNiNombreMarcaLosDosEnSuCampoYNoLlama() {
        vm.alCambiarApodo("   ")
        vm.alUnirse()
        assertEquals(mapOf("codigo" to R.string.unirse_falta_codigo, "apodo" to R.string.unirse_falta_nombre), vm.estado.value.errores)
        vm.alCambiarCodigo("X")
        assertEquals(setOf("apodo"), vm.estado.value.errores.keys)
        assertNull(vm.estado.value.mensaje)
        assertEquals(emptyList<Any>(), pedidos)
    }

    @Test
    fun unaFallaSeMuestraYSePuedeVolverAIntentar() {
        respuesta = AltaDeViaje.Fallo(Resultado.Rechazado(Rechazo.CODIGO_INVALIDO, "x"))
        cargar()
        vm.alUnirse()
        // el código que no sirve va en su campo, no como aviso general
        assertEquals(mapOf("codigo" to R.string.alta_codigo_invalido), vm.estado.value.errores)
        assertNull(vm.estado.value.mensaje)
        assertFalse(vm.estado.value.enviando)
        assertEquals(emptyList<String>(), entradas)
        respuesta = AltaDeViaje.Fallo(Resultado.Incierto)
        vm.alUnirse()
        assertEquals(R.string.alta_incierta, vm.estado.value.mensaje)
        respuesta = AltaDeViaje.Fallo(Resultado.SinConexion)
        vm.alUnirse()
        assertEquals(R.string.alta_sin_conexion, vm.estado.value.mensaje)
    }

    @Test
    fun siYaEstabaEntraSinAviso() {
        respuesta = AltaDeViaje.YaEstaba("v2")
        cargar()
        vm.alUnirse()
        assertNull(vm.estado.value.mensaje)
        assertEquals(listOf("v2"), entradas)
    }

    @Test
    fun mientrasEnviaNoManda2Veces() {
        val lento = UnirseViewModel({ c, p -> pedidos += c to p; respuesta }, "Pixel", {}, kotlinx.coroutines.test.StandardTestDispatcher())
        lento.alCambiarCodigo("X")
        lento.alCambiarApodo("Lu")
        lento.alUnirse()
        lento.alUnirse()
        assertEquals(true, lento.estado.value.enviando)
        assertEquals(emptyList<Any>(), pedidos)
    }
}
