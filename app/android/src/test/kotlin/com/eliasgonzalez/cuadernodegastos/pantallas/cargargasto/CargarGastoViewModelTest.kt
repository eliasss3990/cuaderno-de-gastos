package com.eliasgonzalez.cuadernodegastos.pantallas.cargargasto

import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.gastos.BorradorDeGasto
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Ingesta
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Razon
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CargarGastoViewModelTest {
    private val hilo = UnconfinedTestDispatcher()
    // 2027-02-18 13:52 en Asunción
    private val ahora = 1_802_971_920_000L
    private val almacen = AlmacenMemoria()
    private var n = 0
    private var respuesta: Resultado = Resultado.Aceptada(9)
    private val registrados = mutableListOf<BorradorDeGasto>()

    private fun aplicar(tipo: String, entidad: String, id: String, payload: String) {
        n++
        val op = Operacion("018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", tipo, entidad, id, Reloj.formatear(Hlc(ahora - 100_000 + n, 0, "018f3a6e-0000-7000-8000-000000000001")), Json.parseToJsonElement(payload).jsonObject, 1)
        assertTrue(Ingesta(almacen) { ahora }.procesar(op) is Resultado.Aceptada)
    }

    private fun vm() = CargarGastoViewModel({ LectorDelViaje(almacen) }, { "yo" }, { b, _, _ -> registrados += b; respuesta }, hilo = hilo, nuevoId = { "018f3a6e-2000-7000-8000-0000000000aa" }, ahoraMs = { ahora })

    @Before
    fun antes() {
        Dispatchers.setMain(hilo)
        aplicar("trip.create", "trip", "018f3a6e-1000-7000-8000-000000000001", """{"nombre":"Brasil","zona_horaria":"America/Asuncion","fecha_inicio":"2027-02-15","fecha_fin":"2027-02-28","monedas":[{"codigo":"PYG","decimales":0,"simbolo":"₲"},{"codigo":"BRL","decimales":2,"simbolo":"R$"}]}""")
        aplicar("category.create", "category", "018f3a6e-4000-7000-8000-000000000001", """{"nombre":"Comida","color":"#FDE3D3","emoji":"🍽️"}""")
    }

    @After
    fun despues() = Dispatchers.resetMain()

    @Test
    fun arrancaConLasOpcionesDelViajeYOtroAlFinal() {
        val e = vm().estado.value
        assertEquals(false, e.cargando)
        // en el orden en que las guarda el viaje; sin gastos, la primera
        assertEquals(listOf("BRL", "PYG"), e.monedas.map { it.codigo })
        assertEquals("BRL", e.moneda)
        assertEquals(listOf("Comida", "Otro"), e.categorias.map { it.nombre })
        assertEquals("otro", e.categoria)
        assertEquals("2027-02-18" to "2027-02-28", e.diaImputado to e.finDelViaje)
    }

    @Test
    fun elTecladoFormateaElMontoSegunLaMoneda() {
        val v = vm()
        v.alElegirMoneda("PYG")
        for (c in "1234567") v.alTocarTecla(c)
        assertEquals("1.234.567", v.estado.value.montoTexto)
        v.alBorrar()
        assertEquals("123.456", v.estado.value.montoTexto)
        v.alBorrarTodo()
        assertEquals("", v.estado.value.montoTexto)
        for (c in "123456") v.alTocarTecla(c)
        v.alElegirMoneda("BRL")
        v.alTocarTecla(',')
        v.alTocarTecla('5')
        assertEquals("123.456,5", v.estado.value.montoTexto)
        // a guaraníes se pierden los decimales
        v.alElegirMoneda("PYG")
        assertEquals("123.456", v.estado.value.montoTexto)
    }

    @Test
    fun sinMontoNoGuardaYLoDiceEnElMonto() {
        val v = vm()
        v.alGuardar()
        assertEquals(R.string.gasto_monto_falta, v.estado.value.errorDelMonto)
        assertTrue(registrados.isEmpty())
        v.alTocarTecla('0')
        v.alGuardar()
        assertTrue(registrados.isEmpty())
        v.alTocarTecla('5')
        assertNull(v.estado.value.errorDelMonto)
    }

    @Test
    fun guardaConLoElegidoYTermina() {
        val v = vm()
        v.alElegirMoneda("BRL")
        for (c in "137,5") v.alTocarTecla(c)
        v.alElegirCategoria("018f3a6e-4000-7000-8000-000000000001")
        v.alElegirMetodo("CREDITO")
        v.alCambiarLugar("Do Porto")
        v.alCambiarAlias("Visa")
        v.alElegirDia("2027-02-17")
        v.alGuardar()
        assertEquals(
            BorradorDeGasto(13750, "BRL", "018f3a6e-4000-7000-8000-000000000001", ahora, "2027-02-17", "", "Do Porto", "CREDITO", "Visa", ""),
            registrados.single(),
        )
        assertTrue(v.estado.value.listo)
        // Hoy recibe el gasto para ofrecer deshacer
        assertEquals(GastoGuardado("018f3a6e-2000-7000-8000-0000000000aa", "R$ 137,50", "2027-02-17"), v.estado.value.guardado)
    }

    @Test
    fun tocarElMetodoElegidoLoQuita() {
        val v = vm()
        v.alElegirMetodo("PIX")
        v.alElegirMetodo("PIX")
        assertNull(v.estado.value.metodo)
    }

    @Test
    fun unRechazoSeMuestraYSePuedeReintentar() {
        respuesta = Resultado.Rechazada(Razon.FUERA_DEL_VIAJE)
        val v = vm()
        v.alTocarTecla('5')
        v.alGuardar()
        assertEquals(R.string.gasto_fuera_del_viaje, v.estado.value.mensaje)
        assertEquals(false, v.estado.value.listo || v.estado.value.enviando)
        respuesta = Resultado.Rechazada(Razon.VIAJE_CERRADO)
        v.alGuardar()
        assertEquals(R.string.gasto_viaje_cerrado, v.estado.value.mensaje)
        respuesta = Resultado.Rechazada(Razon.FORMATO)
        v.alGuardar()
        assertEquals(R.string.gasto_no_se_pudo, v.estado.value.mensaje)
    }

    @Test
    fun siElViajeYaNoEstaVinculadoLoDice() {
        val v = CargarGastoViewModel({ LectorDelViaje(almacen) }, { "yo" }, { _, _, _ -> throw com.eliasgonzalez.cuadernodegastos.sincronizacion.ViajeNoVinculado() }, hilo = hilo, ahoraMs = { ahora })
        v.alTocarTecla('5')
        v.alGuardar()
        assertEquals(R.string.gasto_sin_viaje, v.estado.value.mensaje)
    }

    @Test
    fun siOtroCelularQuitoLaCategoriaSeRecarganLasOpcionesYSeAvisa() {
        val v = vm()
        v.alElegirCategoria("018f3a6e-4000-7000-8000-000000000001")
        aplicar("category.archive", "category", "018f3a6e-4000-7000-8000-000000000001", """{"archivada":1}""")
        respuesta = Resultado.Rechazada(Razon.ENTIDAD_INEXISTENTE)
        v.alTocarTecla('5')
        v.alGuardar()
        val e = v.estado.value
        assertEquals(R.string.gasto_categoria_quitada, e.mensaje)
        assertEquals(listOf("Otro"), e.categorias.map { it.nombre })
        assertEquals("otro", e.categoria)
        assertEquals(R.string.gasto_moneda_quitada, run { respuesta = Resultado.Rechazada(Razon.MONEDA_NO_HABILITADA); v.alGuardar(); v.estado.value.mensaje })
    }

    @Test
    fun unaFallaDeLaBaseNoCierraLaAppYSePuedeReintentar() {
        val v = CargarGastoViewModel({ LectorDelViaje(almacen) }, { "yo" }, { _, _, _ -> throw java.io.IOException("disco") }, hilo = hilo, ahoraMs = { ahora })
        v.alTocarTecla('5')
        v.alGuardar()
        assertEquals(R.string.gasto_no_se_pudo to false, v.estado.value.mensaje to v.estado.value.enviando)
    }

    @Test
    fun unMetodoQueEstaVersionNoOfreceNoSePropone() {
        aplicar("expense.create", "expense", "018f3a6e-2000-7000-8000-000000000001", """{"monto_minor":5,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18","metodo_pago":"VALE"}""")
        assertNull(vm().estado.value.metodo)
    }

    @Test
    fun cuentaComoCargadoElAliasYOtroDia() {
        val v = vm()
        v.alCambiarAlias("Visa")
        assertTrue(v.estado.value.cargoAlgo)
        v.alCambiarAlias("")
        v.alElegirDia("2027-02-17")
        assertTrue(v.estado.value.cargoAlgo)
    }

    @Test
    fun dosToquesSeguidosEnGuardarGuardanUnaSolaVez() {
        val v = vm()
        v.alTocarTecla('5')
        v.alGuardar()
        v.alGuardar()
        assertEquals(1, registrados.size)
    }

    @Test
    fun reintentarTrasUnRechazoUsaElMismoGasto() {
        val ids = mutableListOf<String>()
        respuesta = Resultado.Rechazada(Razon.FUERA_DEL_VIAJE)
        var n = 0
        val v = CargarGastoViewModel({ LectorDelViaje(almacen) }, { "yo" }, { _, id, op -> ids += "$id/$op"; respuesta }, hilo = hilo, nuevoId = { "id-${n++}" }, ahoraMs = { ahora })
        v.alTocarTecla('5')
        v.alGuardar()
        respuesta = Resultado.Aceptada(9)
        v.alGuardar()
        // mismo gasto y misma operación: si el primero se hubiera registrado, el segundo queda como duplicado
        assertEquals(listOf("id-0/id-1", "id-0/id-1"), ids)
    }

    @Test
    fun siConEsteGastoSePasanDelTopeSeAvisaMientrasSeEscribeYNoBloquea() {
        aplicar("currency.update", "trip_currency", "BRL", """{"tope_minor":100000}""")
        aplicar("expense.create", "expense", "018f3a6e-2000-7000-8000-000000000001", """{"monto_minor":80000,"moneda":"BRL","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18"}""")
        val v = vm()
        v.alElegirMoneda("BRL")
        for (c in "200") v.alTocarTecla(c)
        // R$ 800 gastados + R$ 200 = justo el tope de R$ 1.000: todavía no
        assertEquals(com.eliasgonzalez.cuadernodegastos.dominio.gastos.AvisoDelTope.NINGUNO, v.estado.value.avisoDelTope)
        v.alTocarTecla(',')
        v.alTocarTecla('5')
        assertEquals(com.eliasgonzalez.cuadernodegastos.dominio.gastos.AvisoDelTope.PASA_CON_ESTE, v.estado.value.avisoDelTope)
        v.alElegirMoneda("PYG")
        assertEquals(com.eliasgonzalez.cuadernodegastos.dominio.gastos.AvisoDelTope.NINGUNO, v.estado.value.avisoDelTope)
        v.alElegirMoneda("BRL")
        v.alGuardar()
        assertEquals(1, registrados.size)
    }

    @Test
    fun siElViajeYaPasoElTopeSeAvisaDesdeQueAbreSinEscribirNada() {
        aplicar("currency.update", "trip_currency", "BRL", """{"tope_minor":100000}""")
        aplicar("expense.create", "expense", "018f3a6e-2000-7000-8000-000000000001", """{"monto_minor":120000,"moneda":"BRL","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18"}""")
        val v = vm()
        v.alElegirMoneda("BRL")
        assertEquals(com.eliasgonzalez.cuadernodegastos.dominio.gastos.AvisoDelTope.YA_PASADO, v.estado.value.avisoDelTope)
    }

    @Test
    fun alPasarAGuaraniesSeAvisanLosCentavosQuitados() {
        val v = vm()
        v.alElegirMoneda("BRL")
        for (c in "50,3") v.alTocarTecla(c)
        v.alElegirMoneda("PYG")
        assertEquals("50" to ",3", v.estado.value.montoTexto to v.estado.value.centavosQuitados)
        v.alTocarTecla('0')
        assertNull(v.estado.value.centavosQuitados)
    }

    @Test
    fun pasadoElFinElDiaPropuestoEsElUltimoYHoySigueSiendoHoy() {
        val v = CargarGastoViewModel({ LectorDelViaje(almacen) }, { "yo" }, { b, _, _ -> registrados += b; respuesta }, hilo = hilo, ahoraMs = { ahora + 15L * 86_400_000 })
        // el viaje termina el 28 de febrero; hoy es 5 de marzo
        assertEquals("2027-02-28" to "2027-03-05", v.estado.value.diaImputado to v.estado.value.hoy)
    }

    @Test
    fun pasadoElFinAbrirYSalirSinTocarNadaNoPreguntaYBorrarQuitaElAvisoDeCentavos() {
        val v = CargarGastoViewModel({ LectorDelViaje(almacen) }, { "yo" }, { b, _, _ -> registrados += b; respuesta }, hilo = hilo, ahoraMs = { ahora + 15L * 86_400_000 })
        assertEquals(false, v.estado.value.cargoAlgo)
        v.alElegirMoneda("BRL")
        for (c in "5,3") v.alTocarTecla(c)
        v.alElegirMoneda("PYG")
        v.alBorrarTodo()
        assertNull(v.estado.value.centavosQuitados)
    }

    @Test
    fun unGastoDeOtroDiaLoDiceAlGuardar() {
        val v = vm()
        v.alTocarTecla('5')
        v.alElegirDia("2027-02-16")
        v.alGuardar()
        assertEquals("2027-02-16", v.estado.value.guardado?.otroDia)
    }

    @Test
    fun siQuitaronLaMonedaElMontoPasaALaOtraSinCambiarDeValorEnSilencio() {
        val v = vm()
        v.alElegirMoneda("BRL")
        for (c in "12,5") v.alTocarTecla(c)
        // otro celular deshabilitó los reales
        respuesta = Resultado.Rechazada(Razon.MONEDA_NO_HABILITADA)
        aplicar("currency.disable", "trip_currency", "BRL", """{"habilitada":0}""")
        v.alGuardar()
        assertEquals(Triple("PYG", "12", ",5"), Triple(v.estado.value.moneda, v.estado.value.montoTexto, v.estado.value.centavosQuitados))
    }
}
