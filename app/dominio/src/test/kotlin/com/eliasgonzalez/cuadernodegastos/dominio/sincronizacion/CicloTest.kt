package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Recepcion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ResultadoDeOperacion
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class CicloTest {
    private val yo = "018f3a6e-0000-7000-8000-00000000000a"
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"
    private val t0 = 1_802_000_000_000L
    private var hora = t0
    private var n = 0

    private fun json(s: String) = Json.parseToJsonElement(s).jsonObject

    /** El servidor de prueba (la misma recepción que el real) con fallas que se pueden pedir. */
    private inner class ServidorDePrueba : Servidor {
        val almacen = AlmacenMemoria()
        val recepcion = Recepcion(almacen) { hora }
        val fallasDeSubida = ArrayDeque<RespuestaDeSubida.Error>()
        val fallasDeBajada = ArrayDeque<RespuestaDeBajada.Error>()
        var maxPorLote = Int.MAX_VALUE
        val lotes = mutableListOf<Int>()
        val paginas = mutableListOf<Int>()

        override fun subir(ops: List<OpGuardada>): RespuestaDeSubida {
            fallasDeSubida.removeFirstOrNull()?.let { return it }
            if (ops.size > maxPorLote) return RespuestaDeSubida.Error(Falla.DEMASIADO_GRANDE)
            lotes += ops.size
            val r = recepcion.procesarLote(ops.map { Operacion(it.opId, it.tipo, it.entidadTipo, it.entidadId, it.hlc, it.payload ?: JsonObject(emptyMap()), it.schemaVersion) }, yo)
            return RespuestaDeSubida.Ok(r.map { RespuestaDeOp(it.opId, it.estado != ResultadoDeOperacion.Estado.RECHAZADA, it.seq, it.hlc, it.razon?.codigo) }, hora)
        }

        override fun bajar(despuesDe: Long, limite: Int): RespuestaDeBajada {
            fallasDeBajada.removeFirstOrNull()?.let { return it }
            val todas = almacen.opsDesde(despuesDe, Int.MAX_VALUE)
            val pagina = todas.take(minOf(limite, 3)) // páginas chicas: varias vueltas con hay_mas
            paginas += pagina.size
            return RespuestaDeBajada.Ok(
                Pagina(pagina.map { OpDelServidor(it.op.opId, it.op.tipo, it.op.entidadTipo, it.op.entidadId, it.op.hlc, it.op.payload, it.op.schemaVersion, it.seq, it.op.padreId) }, todas.size > pagina.size, hora),
            )
        }
    }

    private fun armar(): Triple<ServidorDePrueba, AlmacenMemoria, Pair<Sincronizador, Ciclo>> {
        val servidor = ServidorDePrueba()
        servidor.recepcion.procesarLote(
            listOf(Operacion("018f3a6e-9000-7000-8000-000000000000", "trip.create", "trip", viaje, Reloj.formatear(Hlc(t0 - 1000, 0, yo)), json("""{"nombre":"V","zona_horaria":"America/Asuncion","monedas":[{"codigo":"PYG","decimales":0,"simbolo":"₲"}]}"""), 1)),
            yo,
        )
        val c = AlmacenMemoria()
        c.guardarViajeLocal(ViajeLocal(yo, "m"))
        val s = Sincronizador(c) { hora }
        return Triple(servidor, c, s to Ciclo(s, c, servidor, { hora }, Random(1)))
    }

    private fun gastos(s: Sincronizador, cuantos: Int) = repeat(cuantos) {
        n++
        s.registrar(
            Operacion(
                "018f3a6e-9000-7000-8000-${n.toString().padStart(12, '0')}", "expense.create", "expense", "018f3a6e-2000-7000-8000-${n.toString().padStart(12, '0')}",
                s.nuevaMarca(), json("""{"monto_minor":5,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18"}"""), 1,
            ),
        )
    }

    @Test
    fun subeTodoEnLotesBajaConHayMasYQuedaAlDia() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr() // baja el alta del viaje
        gastos(s, 250)
        assertEquals(FinDelCiclo.AlDia, ciclo.correr())
        assertEquals(listOf(100, 100, 50), servidor.lotes)
        assertTrue(servidor.paginas.size > 3)
        assertEquals(0, c.enEstado(EstadoOp.PENDIENTE).size)
        assertEquals(servidor.almacen.instantanea(), c.instantanea())
    }

    @Test
    fun anteUn413ParteElLoteHastaQueEntra() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        servidor.maxPorLote = 30
        gastos(s, 70)
        assertEquals(FinDelCiclo.AlDia, ciclo.correr())
        assertTrue(servidor.lotes.all { it <= 30 })
        assertEquals(70, servidor.lotes.sum())
        assertEquals("el tamaño que entró se mantiene", listOf(17, 17, 17, 17, 2), servidor.lotes)
        assertEquals(0, c.enEstado(EstadoOp.PENDIENTE).size)
    }

    @Test
    fun unaSolaOpDemasiadoGrandeVaACuarentenaYNoTrabaElResto() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        gastos(s, 2)
        servidor.fallasDeSubida += List(2) { RespuestaDeSubida.Error(Falla.DEMASIADO_GRANDE) } // el lote de 2 y después la primera sola
        assertEquals(FinDelCiclo.AlDia, ciclo.correr())
        assertEquals(1, c.enEstado(EstadoOp.CUARENTENA).size)
        assertEquals("cuerpo_demasiado_grande", c.enEstado(EstadoOp.CUARENTENA).single().razon)
        assertEquals(listOf(1), servidor.lotes) // la segunda sí subió
    }

    @Test
    fun unaFallaTransitoriaReintentaConEsperaCrecienteYRespetaLaDelServidor() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        gastos(s, 3)
        servidor.fallasDeSubida += RespuestaDeSubida.Error(Falla.TRANSITORIA)
        val primero = ciclo.correr() as FinDelCiclo.Reintentar
        assertTrue(primero.enMs in 500..1_000)
        assertEquals(3, c.enEstado(EstadoOp.PENDIENTE).size)
        // todavía no toca: otro ciclo enseguida no manda nada y avisa cuánto falta
        val otraVez = ciclo.correr() as FinDelCiclo.Reintentar
        assertTrue(otraVez.enMs in 1..primero.enMs)
        assertEquals(0, servidor.lotes.size)
        // un segundo fallo seguido espera más que el primero
        hora += primero.enMs
        servidor.fallasDeSubida += RespuestaDeSubida.Error(Falla.TRANSITORIA)
        val segundo = ciclo.correr() as FinDelCiclo.Reintentar
        assertTrue(segundo.enMs in 1_000..2_000)
        hora += segundo.enMs
        servidor.fallasDeSubida += RespuestaDeSubida.Error(Falla.TRANSITORIA, reintentarEnMs = 30_000) // 503 con Retry-After
        assertEquals(FinDelCiclo.Reintentar(30_000), ciclo.correr())
        hora += 30_000
        assertEquals(FinDelCiclo.AlDia, ciclo.correr())
        assertEquals(listOf(3), servidor.lotes)
        // al día, la cuenta vuelve a cero: el próximo fallo espera otra vez alrededor de 1 s
        gastos(s, 1)
        servidor.fallasDeSubida += RespuestaDeSubida.Error(Falla.TRANSITORIA)
        assertTrue((ciclo.correr() as FinDelCiclo.Reintentar).enMs in 500..1_000)
    }

    @Test
    fun revocadoSeDetieneYNoVuelveAPedirNada() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        gastos(s, 1)
        servidor.fallasDeSubida += RespuestaDeSubida.Error(Falla.REVOCADO)
        assertEquals(FinDelCiclo.Revocado, ciclo.correr())
        assertTrue(c.viajeLocal()!!.revocado)
        assertEquals(FinDelCiclo.Revocado, ciclo.correr())
        assertEquals(0, servidor.lotes.size)
        assertEquals(1, c.enEstado(EstadoOp.PENDIENTE).size) // lo cargado no se pierde
    }

    @Test
    fun appDesactualizadaEnLaSubidaNoPierdeElLote() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        gastos(s, 2)
        servidor.fallasDeSubida += RespuestaDeSubida.Error(Falla.APP_DESACTUALIZADA)
        assertEquals(FinDelCiclo.AppDesactualizada, ciclo.correr())
        assertEquals(2, c.enEstado(EstadoOp.PENDIENTE).size)
    }

    @Test
    fun appDesactualizadaEnLaBajada() {
        val (servidor, _, par) = armar()
        servidor.fallasDeBajada += RespuestaDeBajada.Error(Falla.APP_DESACTUALIZADA)
        assertEquals(FinDelCiclo.AppDesactualizada, par.second.correr())
    }

    @Test
    fun loQueQuedoEnCaminoCuandoLaAppMurioVuelveAMandarse() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        gastos(s, 3)
        s.armarLote() // la app muere con el lote en camino
        val otraVida = Ciclo(s, c, servidor, { hora }, Random(2))
        assertEquals(FinDelCiclo.AlDia, otraVida.correr())
        assertEquals(listOf(3), servidor.lotes)
        assertEquals(0, EstadoOp.entries.filter { it != EstadoOp.CONFIRMADA }.sumOf { c.enEstado(it).size })
    }

    @Test
    fun unaBajadaQueFallaAMitadSigueDesdeLoQueYaAplico() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        // otro celular cargó mucho: 10 páginas de 3
        val otro = Armado()
        repeat(30) { otro.gasto(servidor) }
        // la primera página entra y la segunda falla
        val segundaFalla = object : Servidor by servidor {
            var pedidos = 0
            override fun bajar(despuesDe: Long, limite: Int): RespuestaDeBajada =
                if (++pedidos == 2) RespuestaDeBajada.Error(Falla.TRANSITORIA) else servidor.bajar(despuesDe, limite)
        }
        val conFalla = Ciclo(s, c, segundaFalla, { hora }, Random(4))
        assertTrue(conFalla.correr() is FinDelCiclo.Reintentar)
        val visto = c.viajeLocal()!!.ultimoSeq
        assertTrue(visto > 1)
        assertEquals(FinDelCiclo.AlDia, conFalla.correr())
        assertEquals(servidor.almacen.instantanea(), c.instantanea())
    }

    @Test
    fun hayMasSinAvanzarNoQuedaEnUnBucle() {
        val (servidor, c, par) = armar()
        val trabado = object : Servidor by servidor {
            override fun bajar(despuesDe: Long, limite: Int) = RespuestaDeBajada.Ok(Pagina(emptyList(), hayMas = true, horaDelServidor = hora))
        }
        val ciclo = Ciclo(par.first, c, trabado, { hora }, Random(5))
        val primero = ciclo.correr() as FinDelCiclo.Reintentar
        val segundo = ciclo.correr() as FinDelCiclo.Reintentar
        assertTrue("la espera crece", segundo.enMs > primero.enMs)
        // cuando el servidor vuelve a responder bien, el mismo ciclo se pone al día
        assertEquals(FinDelCiclo.AlDia, Ciclo(par.first, c, servidor, { hora }, Random(5)).correr())
    }

    @Test
    fun revocadoTambienEnLaBajada() {
        val (servidor, c, par) = armar()
        servidor.fallasDeBajada += RespuestaDeBajada.Error(Falla.REVOCADO)
        assertEquals(FinDelCiclo.Revocado, par.second.correr())
        assertTrue(c.viajeLocal()!!.revocado)
    }

    @Test
    fun unaCascadaDe413DesdeCienTerminaConLaOpQueNoEntraEnCuarentena() {
        val (servidor, c, par) = armar()
        val (s, ciclo) = par
        ciclo.correr()
        gastos(s, 100)
        // 100, 50, 25, 12, 6, 3, 1: siete 413 seguidos y la primera queda en cuarentena; el resto sube
        servidor.fallasDeSubida += List(7) { RespuestaDeSubida.Error(Falla.DEMASIADO_GRANDE) }
        assertEquals(FinDelCiclo.AlDia, ciclo.correr())
        assertEquals(1, c.enEstado(EstadoOp.CUARENTENA).size)
        assertEquals(99, servidor.lotes.sum())
    }

    @Test
    fun unRetryAfterNegativoNoDaUnaEsperaNegativa() {
        val (servidor, _, par) = armar()
        servidor.fallasDeBajada += RespuestaDeBajada.Error(Falla.TRANSITORIA, reintentarEnMs = -5)
        assertEquals(FinDelCiclo.Reintentar(0), par.second.correr())
    }

    /** Otro celular que sube directo al servidor de prueba. */
    private inner class Armado {
        private val dispositivo = "018f3a6e-0000-7000-8000-00000000000b"
        private var k = 0

        fun gasto(servidor: ServidorDePrueba) {
            k++
            val id = "018f3a6e-2000-7000-8000-${(1000 + k).toString().padStart(12, '0')}"
            servidor.recepcion.procesarLote(
                listOf(Operacion("018f3a6e-9000-7000-8000-${(1000 + k).toString().padStart(12, '0')}", "expense.create", "expense", id, Reloj.formatear(Hlc(t0 + k, 0, dispositivo)), json("""{"monto_minor":5,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18"}"""), 1)),
                dispositivo,
            )
        }
    }

    @Test
    fun laEsperaCreceSeAcotaYTieneAzar() {
        val azar = Random(3)
        assertTrue(Espera.tras(1, azar) in 500..1_000)
        assertTrue(Espera.tras(2, azar) in 1_000..2_000)
        assertTrue(Espera.tras(5, azar) in 8_000..16_000)
        for (i in 1..100) assertTrue(Espera.tras(i, azar) <= Espera.MAXIMA_MS)
        assertTrue(Espera.tras(40, azar) >= Espera.MAXIMA_MS / 2)
        assertTrue((1..20).map { Espera.tras(6, Random(it)) }.distinct().size > 5)
    }
}
