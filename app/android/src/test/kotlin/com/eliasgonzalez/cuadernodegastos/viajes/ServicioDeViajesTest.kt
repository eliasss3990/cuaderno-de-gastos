package com.eliasgonzalez.cuadernodegastos.viajes

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado as ResultadoDelMotor
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.OpDelServidor
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.ViajeLocal
import com.eliasgonzalez.cuadernodegastos.red.Credenciales
import com.eliasgonzalez.cuadernodegastos.red.MonedaNueva
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.red.Rechazo
import com.eliasgonzalez.cuadernodegastos.red.Resultado
import com.eliasgonzalez.cuadernodegastos.red.ViajeNuevo
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Un servidor de mentira: crea el viaje, y al sincronizar baja su alta (como lo escribe el servidor). */
private class Puertos : PuertosDeViajes {
    val viaje = "018f3a6e-1000-7000-8000-000000000001"
    val dispositivo = "018f3a6e-0000-7000-8000-00000000000a"
    val almacen = AlmacenMemoria()
    val sinc = Sincronizador(almacen) { 1_802_000_000_000 }
    var alta: Resultado<Credenciales> = Resultado.Ok(Credenciales(viaje, dispositivo, "018f3a6e-0b00-7000-8000-000000000001", "t"))
    var finesDeBajar = ArrayDeque<FinDelCiclo>()
    var creado: ViajeNuevo? = null
    var codigo: String? = null
    val vinculados = mutableListOf<String>()
    private var bajado = false

    override fun crear(viaje: ViajeNuevo, quien: Perfil): Resultado<Credenciales> {
        creado = viaje
        return alta
    }

    override fun unirse(codigo: String, quien: Perfil): Resultado<Credenciales> {
        this.codigo = codigo
        return alta
    }

    override fun vinculado(viaje: String) = viaje in vinculados

    override fun vincular(c: Credenciales) {
        vinculados += c.viaje
        almacen.guardarViajeLocal(ViajeLocal(c.dispositivo, c.integrante))
    }

    override fun sincronizar(viaje: String): FinDelCiclo {
        val fin = finesDeBajar.removeFirstOrNull() ?: FinDelCiclo.AlDia
        if (fin == FinDelCiclo.AlDia && !bajado) {
            val v = creado ?: ViajeNuevo("V", "America/Asuncion", listOf(MonedaNueva("PYG", 0, "₲")))
            val monedas = JsonArray(v.monedas.map { JsonObject(mapOf("codigo" to JsonPrimitive(it.codigo), "decimales" to JsonPrimitive(it.decimales), "simbolo" to JsonPrimitive(it.simbolo))) })
            val payload = buildMap {
                put("nombre", JsonPrimitive(v.nombre))
                put("zona_horaria", JsonPrimitive(v.zonaHoraria))
                put("monedas", monedas)
                v.fechaInicio?.let { put("fecha_inicio", JsonPrimitive(it)) }
                v.fechaFin?.let { put("fecha_fin", JsonPrimitive(it)) }
            }
            sinc.aplicarBajada(listOf(OpDelServidor("018f3a6e-9000-7000-8000-000000000000", "trip.create", "trip", this.viaje, Reloj.formatear(Hlc(1_801_999_000_000, 0, dispositivo)), JsonObject(payload), 1, 1)), null)
            bajado = true
        }
        return fin
    }

    var rechazarRegistros = false

    override fun registrar(viaje: String, op: (Sincronizador) -> Operacion): ResultadoDelMotor =
        if (rechazarRegistros) ResultadoDelMotor.Rechazada(com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Razon.FORMATO) else sinc.registrar(op(sinc))
}

class ServicioDeViajesTest {
    private val p = Puertos()
    private val esperas = mutableListOf<Long>()
    private val s = ServicioDeViajes(p, { 1_802_000_000_000 }) { esperas += it }
    private val yo = Perfil("Pixel", "Eli", "#E8E4F3", "🙂")
    private val plan = PlanNuevo(
        nombre = "Brasil 2027",
        zonaHoraria = "America/Asuncion",
        monedas = listOf(MonedaNueva("PYG", 0, "₲"), MonedaNueva("BRL", 2, "R$")),
        fechaInicio = "2027-02-15",
        fechaFin = "2027-02-28",
        topes = mapOf("PYG" to 10_000_000L, "BRL" to 560_000L),
        efectivoInicial = mapOf("PYG" to 1_500_000L),
        objetivos = "Conocer las Cataratas",
    )

    @Test
    fun crearDaDeAltaBajaElViajeYGuardaElPlanParaSubir() {
        assertEquals(AltaDeViaje.Lista(p.viaje), s.crear(plan, yo))
        assertEquals(ViajeNuevo("Brasil 2027", "America/Asuncion", plan.monedas, "2027-02-15", "2027-02-28"), p.creado)
        assertEquals(listOf(p.viaje), p.vinculados)
        val lector = LectorDelViaje(p.almacen)
        val m = lector.monedas().associateBy { it.moneda.codigo }
        assertEquals(10_000_000L to 1_500_000L, m.getValue("PYG").topeMinor to m.getValue("PYG").efectivoInicialMinor)
        assertEquals(560_000L to null, m.getValue("BRL").topeMinor to m.getValue("BRL").efectivoInicialMinor)
        assertEquals("Conocer las Cataratas", lector.viaje()!!.objetivos)
        // dos monedas con algo y los objetivos: tres operaciones propias esperando subir
        assertEquals(3, p.almacen.enEstado(EstadoOp.PENDIENTE).size)
    }

    @Test
    fun unPlanQueNoSePuedeGuardarEsUnErrorDeProgramacionYSeAvisa() {
        p.rechazarRegistros = true
        org.junit.Assert.assertThrows(IllegalStateException::class.java) { s.crear(plan, yo) }
    }

    @Test
    fun siElViajeQuedoRevocadoNoSeSigueIntentando() {
        val q = Puertos().also { it.finesDeBajar.addAll(listOf(FinDelCiclo.Revocado)) }
        assertEquals(AltaDeViaje.SinPlan(q.viaje, plan), ServicioDeViajes(q, { 1_802_000_000_000 }) { error("no debía esperar") }.crear(plan, yo))
        // los otros dos fines quedaron sin pedir
        assertEquals(0, q.finesDeBajar.size)
    }

    @Test
    fun unPlanSinTopesNiObjetivosNoGuardaNadaMas() {
        assertEquals(AltaDeViaje.Lista(p.viaje), s.crear(plan.copy(topes = emptyMap(), efectivoInicial = mapOf("PYG" to null), objetivos = "  "), yo))
        assertTrue(p.almacen.enEstado(EstadoOp.PENDIENTE).isEmpty())
    }

    @Test
    fun siNoSePuedeBajarReintentaYSigueSinElPlan() {
        p.finesDeBajar.addAll(listOf(FinDelCiclo.Reintentar(1000), FinDelCiclo.Reintentar(1000)))
        assertEquals(AltaDeViaje.Lista(p.viaje), s.crear(plan, yo))
        // espera lo que pide el ciclo (con un tope de 3 s) entre intentos, no después del último
        assertEquals(listOf(1000L, 1000L), esperas)
        val q = Puertos().also { it.finesDeBajar.addAll(listOf(FinDelCiclo.Reintentar(60_000), FinDelCiclo.Reintentar(500), FinDelCiclo.Reintentar(9))) }
        val esperasQ = mutableListOf<Long>()
        val sq = ServicioDeViajes(q, { 1_802_000_000_000 }) { esperasQ += it }
        // el plan cargado viaja en el resultado y se puede volver a intentar
        assertEquals(AltaDeViaje.SinPlan(q.viaje, plan), sq.crear(plan, yo))
        assertEquals(listOf(3_000L, 500L), esperasQ)
        assertEquals(listOf(q.viaje), q.vinculados)
        assertTrue(q.almacen.enEstado(EstadoOp.PENDIENTE).isEmpty())
        assertEquals(AltaDeViaje.Lista(q.viaje), sq.guardarPlan(q.viaje, plan))
        assertEquals(10_000_000L, LectorDelViaje(q.almacen).monedas().single { it.moneda.codigo == "PYG" }.topeMinor)
    }

    @Test
    fun unPlanInvalidoNoLlegaAlServidor() {
        val casos = listOf(
            plan.copy(nombre = " ") to "nombre",
            plan.copy(monedas = emptyList(), topes = emptyMap(), efectivoInicial = emptyMap()) to "monedas",
            plan.copy(monedas = plan.monedas + MonedaNueva("PYG", 0, "₲")) to "monedas",
            plan.copy(fechaFin = "2027-02-14") to "fecha_fin",
            plan.copy(topes = mapOf("USD" to 5L)) to "monedas",
            plan.copy(efectivoInicial = mapOf("PYG" to -1L)) to "montos",
            plan.copy(topes = mapOf("BRL" to -5L)) to "montos",
            plan.copy(zonaHoraria = "Marte/Olympus") to "zona_horaria",
            plan.copy(zonaHoraria = "") to "zona_horaria",
            plan.copy(fechaInicio = "15/02/2027") to "fechas",
            plan.copy(fechaFin = "2027-02-30") to "fechas",
        )
        for ((malo, campo) in casos) {
            val r = s.crear(malo, yo)
            assertEquals(malo.toString(), campo, (r as AltaDeViaje.PlanInvalido).campo)
        }
        assertEquals(null, p.creado)
        // sin fecha de fin, o el mismo día, está bien
        assertEquals(null, plan.copy(fechaFin = null).problema())
        assertEquals(null, plan.copy(fechaFin = "2027-02-15").problema())
    }

    @Test
    fun unaFallaAlCrearOUnirseNoVinculaNada() {
        for (f in listOf(Resultado.SinConexion, Resultado.Incierto, Resultado.AppDesactualizada, Resultado.Rechazado(Rechazo.CODIGO_INVALIDO, "código inválido"))) {
            p.alta = f
            assertEquals(AltaDeViaje.Fallo(f), s.crear(plan, yo))
            assertEquals(AltaDeViaje.Fallo(f), s.unirse("abcd2345", yo))
        }
        assertTrue(p.vinculados.isEmpty())
    }

    @Test
    fun unirseNormalizaElCodigoVinculaYBaja() {
        assertEquals(AltaDeViaje.Lista(p.viaje), s.unirse("  k7m4-9xq2 ", yo))
        assertEquals("K7M4-9XQ2", p.codigo)
        assertEquals(listOf(p.viaje), p.vinculados)
        assertEquals("V", LectorDelViaje(p.almacen).viaje()!!.nombre)
        // sin conexión después de unirse: igual queda vinculado, y la pantalla sabe que falta bajar
        val q = Puertos().also { it.finesDeBajar.addAll(List(3) { FinDelCiclo.Reintentar(1000) }) }
        assertEquals(AltaDeViaje.Lista(q.viaje, alDia = false), ServicioDeViajes(q).unirse("X", yo))
        // otra vez el mismo viaje: ya estaba, y no se vincula de nuevo
        assertEquals(AltaDeViaje.YaEstaba(p.viaje), s.unirse("otro-codigo", yo))
        assertEquals(listOf(p.viaje), p.vinculados)
    }
}
