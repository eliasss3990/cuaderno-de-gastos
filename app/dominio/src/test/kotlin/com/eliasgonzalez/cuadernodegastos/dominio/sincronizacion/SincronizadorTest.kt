package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Razon
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SincronizadorTest {
    private val yo = "018f3a6e-0000-7000-8000-00000000000a"
    private val otro = "018f3a6e-0000-7000-8000-00000000000b"
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"
    private val gasto = "018f3a6e-2000-7000-8000-000000000001"
    private val t0 = 1_802_000_000_000L
    private var hora = t0
    private var n = 0
    private var seq = 0L

    private fun json(s: String) = Json.parseToJsonElement(s).jsonObject

    private fun marca(ms: Long, dispositivo: String, contador: Int = 0) = Reloj.formatear(Hlc(ms, contador, dispositivo))

    private fun opId() = "018f3a6e-9000-7000-8000-${(++n).toString().padStart(12, '0')}"

    private fun delServidor(tipo: String, entidad: String, id: String, payload: String?, hlc: String) =
        OpDelServidor(opId(), tipo, entidad, id, hlc, payload?.let { json(it) }, 1, ++seq)

    /** Un celular vinculado a un viaje que ya bajó el alta (como la escribe el servidor). */
    private fun celular(): Pair<AlmacenMemoria, Sincronizador> {
        val c = AlmacenMemoria()
        c.guardarViajeLocal(ViajeLocal(yo, "m1"))
        val s = Sincronizador(c) { hora }
        s.aplicarBajada(
            listOf(
                delServidor("trip.create", "trip", viaje, """{"nombre":"V","zona_horaria":"America/Asuncion","monedas":[{"codigo":"PYG","decimales":0,"simbolo":"₲"}]}""", marca(t0 - 10_000, yo)),
                delServidor("member.join", "member", "018f3a6e-0b00-7000-8000-000000000001", """{"apodo":"P","color":"#FFE2B8","emoji":"🦁","es_organizador":1}""", marca(t0 - 10_000, yo, 1)),
            ),
            t0,
        )
        return c to s
    }

    private fun alta(s: Sincronizador, id: String = gasto, concepto: String = "c") =
        Operacion(opId(), "expense.create", "expense", id, s.nuevaMarca(), json("""{"monto_minor":5,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":$hora,"dia_imputado":"2027-02-18","concepto":"$concepto"}"""), 1)

    private fun edicion(s: Sincronizador, campos: String, id: String = gasto) = Operacion(opId(), "expense.update", "expense", id, s.nuevaMarca(), json(campos), 1)

    private fun campo(c: AlmacenMemoria, nombre: String, id: String = gasto) = c.leerCampo("expense", id, nombre)

    @Test
    fun registrarAplicaYEncolaYLaPropiaArmaElLoteEnOrden() {
        val (c, s) = celular()
        val a = alta(s)
        assertTrue(s.registrar(a) is Resultado.Aceptada)
        val e = edicion(s, """{"concepto":"d"}""")
        s.registrar(e)
        assertEquals(JsonPrimitive("d"), campo(c, "concepto"))
        assertEquals(listOf(a.opId, e.opId), c.enEstado(EstadoOp.PENDIENTE).map { it.op.opId })
        assertEquals(a.opId, c.buscarEnCola(e.opId)!!.dependeDe)
        val lote = s.armarLote()
        assertEquals(listOf(a.opId, e.opId), lote.map { it.opId })
        assertEquals(2, c.enEstado(EstadoOp.ENVIANDO).size)
        assertEquals(emptyList<Any>(), s.armarLote())
    }

    @Test
    fun loQueElEstadoNoAdmiteNoSeGuarda() {
        val (c, s) = celular()
        val a = alta(s).let { it.copy(payload = JsonObject(it.payload + ("moneda" to JsonPrimitive("BRL")))) }
        assertEquals(Resultado.Rechazada(Razon.MONEDA_NO_HABILITADA), s.registrar(a))
        assertFalse(c.opConocida(a.opId))
    }

    @Test
    fun lasMarcasUsanLaHoraDelServidorAprendida() {
        val (c, s) = celular()
        // el celular atrasa 5 minutos: lo aprende en la respuesta y sus marcas salen con la hora del servidor
        s.respuestaDelLote(emptyList(), hora + 300_000)
        assertEquals(300_000L, c.viajeLocal()!!.desfaseMs)
        assertTrue(Reloj.parsear(s.nuevaMarca())!!.ms >= hora + 300_000)
    }

    @Test
    fun loQueNoTieneFormatoNoSeGuarda() {
        val (c, s) = celular()
        val mal = alta(s).copy(payload = json("""{"monto_minor":-1}"""))
        assertEquals(Resultado.Rechazada(Razon.FORMATO), s.registrar(mal))
        assertFalse(c.opConocida(mal.opId))
    }

    @Test
    fun conElViajeCerradoLaAppNoDejaCargar() {
        val (c, s) = celular()
        val cierre = edicion(s, """{"estado_manual":"CERRADO"}""").copy(tipo = "trip.update", entidadTipo = "trip", entidadId = viaje)
        assertTrue(s.registrar(cierre) is Resultado.Aceptada)
        hora += 1000
        val a = alta(s)
        assertEquals(Resultado.Rechazada(Razon.VIAJE_CERRADO), s.registrar(a))
        assertFalse(c.opConocida(a.opId))
    }

    @Test
    fun unLoteQueNoLlegoVuelveAPendientesConElIntentoAnotado() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.armarLote()
        s.loteNoEnviado(listOf(a.opId), hora + 5_000)
        val o = c.buscarEnCola(a.opId)!!
        assertEquals(listOf(EstadoOp.PENDIENTE, 1, hora + 5_000), listOf(o.estado, o.intentos, o.proximoIntentoEn))
        assertEquals(emptyList<Any>(), s.armarLote()) // todavía no toca
        hora += 5_000
        assertEquals(listOf(a.opId), s.armarLote().map { it.opId })
    }

    @Test
    fun unaOpQueEsperaUnReintentoNoDejaPasarALasQueVienenDespues() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.armarLote()
        s.loteNoEnviado(listOf(a.opId), hora + 60_000)
        val e = edicion(s, """{"concepto":"x"}""")
        s.registrar(e)
        assertEquals(emptyList<Any>(), s.armarLote())
        hora += 60_000
        assertEquals(listOf(a.opId, e.opId), s.armarLote().map { it.opId })
        assertEquals(EstadoOp.ENVIANDO, c.buscarEnCola(e.opId)!!.estado)
    }

    @Test
    fun corregirUnaMarcaPropiaNoBajaLaUltimaPorDebajoDeUnaAjenaYaVista() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, true, ++seq, a.hlc, null)), hora)
        // otro celular, adelantado 4 minutos (dentro de la tolerancia del servidor), edita; lo veo
        val ajena = marca(hora + 240_000, otro)
        s.aplicarBajada(listOf(delServidor("expense.update", "expense", gasto, """{"nota":"ajena"}""", ajena)), hora)
        // una edición mía que venía del futuro: el servidor la corrige a su hora
        val e = edicion(s, """{"concepto":"mia"}""").copy(hlc = marca(hora + 900_000, yo))
        s.registrar(e)
        s.respuestaDelLote(listOf(RespuestaDeOp(e.opId, true, ++seq, marca(hora, yo, 3), null)), hora)
        // lo próximo que edite queda después de la ajena que ya vi
        assertTrue(s.nuevaMarca().substring(0, 18) > ajena.substring(0, 18))
    }

    @Test
    fun aceptadaSeConfirmaConSuSecuencia() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.armarLote()
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, true, ++seq, a.hlc, null)), hora)
        val o = c.buscarEnCola(a.opId)!!
        assertEquals(EstadoOp.CONFIRMADA to seq, o.estado to o.serverSeq)
    }

    @Test
    fun conLaMarcaCorregidaGanaLaEdicionAjenaQueAntesPerdia() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, true, ++seq, a.hlc, null)), hora)
        // mi edición sale con el reloj adelantado 10 minutos
        hora += 600_000
        val e = edicion(s, """{"concepto":"mia"}""")
        s.registrar(e)
        // otro celular edita después en tiempo real, pero con una marca menor que la mía
        s.aplicarBajada(listOf(delServidor("expense.update", "expense", gasto, """{"concepto":"ajena"}""", marca(t0 + 1_000, otro))), t0 + 1_000)
        assertEquals(JsonPrimitive("mia"), campo(c, "concepto"))
        // el servidor corrige mi marca a su hora, antes que la ajena: gana la ajena
        val corregida = marca(t0 + 500, yo)
        s.respuestaDelLote(listOf(RespuestaDeOp(e.opId, true, ++seq, corregida, null)), t0 + 2_000)
        assertEquals(JsonPrimitive("ajena"), campo(c, "concepto"))
        assertEquals(corregida, c.buscarEnCola(e.opId)!!.op.hlc)
        // la próxima marca propia ya no sale del futuro
        hora = t0 + 3_000
        assertTrue(s.nuevaMarca() < marca(t0 + 300_000, yo))
    }

    @Test
    fun unRechazoPoneEnCuarentenaALaOpYASusDependientes() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        val e1 = edicion(s, """{"concepto":"x"}""")
        s.registrar(e1)
        val otroGasto = "018f3a6e-2000-7000-8000-000000000002"
        val b = alta(s, otroGasto)
        s.registrar(b)
        s.armarLote(1)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, false, null, a.hlc, "viaje_cerrado")), hora)
        assertEquals(EstadoOp.CUARENTENA to "viaje_cerrado", c.buscarEnCola(a.opId)!!.let { it.estado to it.razon })
        assertEquals(EstadoOp.CUARENTENA to Sincronizador.DEPENDIENTE, c.buscarEnCola(e1.opId)!!.let { it.estado to it.razon })
        assertEquals(EstadoOp.PENDIENTE, c.buscarEnCola(b.opId)!!.estado) // la de otra entidad sigue
        // reintentar devuelve la cadena entera en el orden original
        s.reintentar(a.opId)
        assertEquals(listOf(a.opId, e1.opId, b.opId), c.enEstado(EstadoOp.PENDIENTE).map { it.op.opId })
    }

    @Test
    fun unGastoDeUnaCategoriaNuevaDependeDeEsaCategoria() {
        val (c, s) = celular()
        val cat = "018f3a6e-7000-7000-8000-000000000001"
        val alta = Operacion(opId(), "category.create", "category", cat, s.nuevaMarca(), json("""{"nombre":"C","color":"#E8E4F3","emoji":"x"}"""), 1)
        s.registrar(alta)
        val g = alta(s).let { it.copy(payload = JsonObject(it.payload + ("categoria_id" to JsonPrimitive(cat)))) }
        s.registrar(g)
        assertEquals(alta.opId, c.buscarEnCola(g.opId)!!.dependeDe)
    }

    @Test
    fun laCascadaSigueTodasLasReferenciasNoUnSoloPuntero() {
        val (c, s) = celular()
        val cat = "018f3a6e-7000-7000-8000-000000000001"
        val altaCat = Operacion(opId(), "category.create", "category", cat, s.nuevaMarca(), json("""{"nombre":"C","color":"#E8E4F3","emoji":"x"}"""), 1)
        s.registrar(altaCat)
        val g = alta(s).let { it.copy(payload = JsonObject(it.payload + ("categoria_id" to JsonPrimitive(cat)))) }
        s.registrar(g)
        val usd = Operacion(opId(), "currency.enable", "trip_currency", "USD", s.nuevaMarca(), json("""{"habilitada":1,"decimales":2,"simbolo":"$"}"""), 1)
        s.registrar(usd)
        // la edición usa la moneda nueva y el gasto de la categoría nueva: su puntero apunta a la moneda
        val e = edicion(s, """{"moneda":"USD"}""")
        s.registrar(e)
        assertEquals(usd.opId, c.buscarEnCola(e.opId)!!.dependeDe)
        s.armarLote(1)
        s.respuestaDelLote(listOf(RespuestaDeOp(altaCat.opId, false, null, altaCat.hlc, "formato")), hora)
        // rechazada la categoría, caen el gasto y también la edición del gasto (aunque su puntero sea la moneda)
        assertEquals(EstadoOp.CUARENTENA, c.buscarEnCola(g.opId)!!.estado)
        assertEquals(EstadoOp.CUARENTENA, c.buscarEnCola(e.opId)!!.estado)
        assertEquals(EstadoOp.PENDIENTE, c.buscarEnCola(usd.opId)!!.estado)
        // reintentar la edición reintenta desde la raíz que sigue en cuarentena
        s.reintentar(e.opId)
        assertEquals(EstadoOp.PENDIENTE, c.buscarEnCola(altaCat.opId)!!.estado)
    }

    @Test
    fun siUnaEnCuarentenaVuelveConfirmadaSusDependientesVuelvenALaCola() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        val e = edicion(s, """{"concepto":"x"}""")
        s.registrar(e)
        s.armarLote(1)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, false, null, a.hlc, "formato")), hora)
        assertEquals(EstadoOp.CUARENTENA, c.buscarEnCola(e.opId)!!.estado)
        // la primera vez había llegado (se perdió la respuesta): vuelve por la bajada
        s.aplicarBajada(listOf(OpDelServidor(a.opId, a.tipo, a.entidadTipo, a.entidadId, a.hlc, a.payload, 1, ++seq)), hora)
        assertEquals(EstadoOp.CONFIRMADA, c.buscarEnCola(a.opId)!!.estado)
        assertEquals(EstadoOp.PENDIENTE, c.buscarEnCola(e.opId)!!.estado)
    }

    @Test
    fun alConfirmarUnaRaizNoSeLiberaUnaDependienteDeOtraRaizQueSigueRechazada() {
        val (c, s) = celular()
        val cat = "018f3a6e-7000-7000-8000-000000000001"
        val altaCat = Operacion(opId(), "category.create", "category", cat, s.nuevaMarca(), json("""{"nombre":"C","color":"#E8E4F3","emoji":"x"}"""), 1)
        s.registrar(altaCat)
        val a = alta(s)
        s.registrar(a)
        // la edición usa la categoría nueva: depende de las dos altas
        val e = edicion(s, """{"categoria_id":"$cat"}""")
        s.registrar(e)
        s.armarLote(2)
        s.respuestaDelLote(listOf(RespuestaDeOp(altaCat.opId, false, null, altaCat.hlc, "formato"), RespuestaDeOp(a.opId, false, null, a.hlc, "formato")), hora)
        assertEquals(EstadoOp.CUARENTENA, c.buscarEnCola(e.opId)!!.estado)
        // el alta del gasto había llegado: vuelve por la bajada; la categoría sigue rechazada, así que la edición no sale
        s.aplicarBajada(listOf(OpDelServidor(a.opId, a.tipo, a.entidadTipo, a.entidadId, a.hlc, a.payload, 1, ++seq)), hora)
        assertEquals(EstadoOp.CUARENTENA, c.buscarEnCola(e.opId)!!.estado)
        // cuando también aparece la categoría, recién ahí la edición vuelve a la cola
        s.aplicarBajada(listOf(OpDelServidor(altaCat.opId, altaCat.tipo, altaCat.entidadTipo, altaCat.entidadId, altaCat.hlc, altaCat.payload, 1, ++seq)), hora)
        assertEquals(EstadoOp.PENDIENTE, c.buscarEnCola(e.opId)!!.estado)
    }

    @Test
    fun alConfirmarUnaRaizSeLiberaTodaLaCadena() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        val e1 = edicion(s, """{"concepto":"x"}""")
        s.registrar(e1)
        val e2 = edicion(s, """{"nota":"y"}""")
        s.registrar(e2)
        s.armarLote(1)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, false, null, a.hlc, "formato")), hora)
        s.aplicarBajada(listOf(OpDelServidor(a.opId, a.tipo, a.entidadTipo, a.entidadId, a.hlc, a.payload, 1, ++seq)), hora)
        assertEquals(listOf(e1.opId, e2.opId), c.enEstado(EstadoOp.PENDIENTE).map { it.op.opId })
    }

    @Test
    fun unaPendienteQueYaSalioNoSeDescartaPorquePudoHaberLlegado() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.armarLote()
        s.loteNoEnviado(listOf(a.opId), null) // no se sabe si llegó
        try {
            s.descartar(a.opId)
            throw AssertionError("no debía dejar descartar")
        } catch (_: IllegalStateException) {
        }
        assertTrue(c.opConocida(a.opId))
    }

    @Test
    fun descartarUnAltaBorraLaEntidadYSusDependientes() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        val e = edicion(s, """{"concepto":"x"}""")
        s.registrar(e)
        s.descartar(a.opId)
        assertFalse(c.entidadExiste("expense", gasto))
        assertFalse(c.opConocida(a.opId))
        assertFalse(c.opConocida(e.opId))
    }

    @Test
    fun descartarUnaEdicionVuelveAlValorAnterior() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, true, ++seq, a.hlc, null)), hora)
        val e = edicion(s, """{"concepto":"nuevo","nota":"n"}""")
        s.registrar(e)
        s.descartar(e.opId)
        assertEquals(JsonPrimitive("c"), campo(c, "concepto"))
        assertNull(campo(c, "nota"))
        assertTrue(c.entidadExiste("expense", gasto))
    }

    @Test
    fun unaPurgaPropiaNoBorraHastaQueElServidorLaConfirme() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, true, ++seq, a.hlc, null)), hora)
        val p = Operacion(opId(), "expense.purge", "expense", gasto, s.nuevaMarca(), JsonObject(emptyMap()), 1)
        assertTrue(s.registrar(p) is Resultado.Aceptada)
        assertTrue(c.entidadExiste("expense", gasto))
        assertEquals(JsonPrimitive("c"), campo(c, "concepto"))
        // si el servidor la rechaza, el gasto sigue intacto
        s.armarLote()
        s.respuestaDelLote(listOf(RespuestaDeOp(p.opId, false, null, p.hlc, "viaje_cerrado")), hora)
        assertTrue(c.entidadExiste("expense", gasto))
        // reintentada y aceptada, recién ahí se borra y se redacta
        s.reintentar(p.opId)
        s.armarLote()
        s.respuestaDelLote(listOf(RespuestaDeOp(p.opId, true, ++seq, p.hlc, null)), hora)
        assertFalse(c.entidadExiste("expense", gasto))
        assertTrue(c.entidadTerminada("expense", gasto))
        assertNull(c.buscarEnCola(a.opId)!!.op.payload)
        assertEquals(EstadoOp.CONFIRMADA to seq, c.buscarEnCola(p.opId)!!.let { it.estado to it.serverSeq })
    }

    @Test
    fun unaPurgaPropiaConfirmadaDespuesDeQueOtroYaPurgoNoSePierdeDelRegistro() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, true, ++seq, a.hlc, null)), hora)
        val p = Operacion(opId(), "expense.purge", "expense", gasto, s.nuevaMarca(), JsonObject(emptyMap()), 1)
        s.registrar(p)
        s.armarLote()
        // otro celular purgó antes; baja su purga y después llega la confirmación de la mía (el servidor la acepta redactada)
        s.aplicarBajada(listOf(delServidor("expense.purge", "expense", gasto, null, marca(t0 + 1, otro))), hora)
        assertTrue(c.entidadTerminada("expense", gasto))
        s.respuestaDelLote(listOf(RespuestaDeOp(p.opId, true, ++seq, p.hlc, null)), hora)
        assertEquals(EstadoOp.CONFIRMADA to seq, c.buscarEnCola(p.opId)!!.let { it.estado to it.serverSeq })
    }

    @Test
    fun unaEdicionPropiaPendienteDeUnGastoQueOtroPurgoSubeEnteraYSeRedactaAlConfirmarse() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.respuestaDelLote(listOf(RespuestaDeOp(a.opId, true, ++seq, a.hlc, null)), hora)
        val e = edicion(s, """{"concepto":"x"}""")
        s.registrar(e)
        s.aplicarBajada(listOf(delServidor("expense.purge", "expense", gasto, null, marca(t0 + 1, otro))), hora)
        // la propia sin confirmar conserva sus datos para poder subirla; la confirmada sí se redactó
        assertEquals(json("""{"concepto":"x"}"""), s.armarLote().single().payload)
        assertNull(c.buscarEnCola(a.opId)!!.op.payload)
        // el servidor la acepta redactada (el gasto ya estaba purgado): el celular la redacta al confirmarla
        s.respuestaDelLote(listOf(RespuestaDeOp(e.opId, true, ++seq, e.hlc, null)), hora)
        assertNull(c.buscarEnCola(e.opId)!!.op.payload)
    }

    @Test
    fun laBajadaAplicaAjenasYRedactadasSinRechazarYConfirmaLasPropias() {
        val (c, s) = celular()
        val a = alta(s)
        s.registrar(a)
        s.armarLote()
        // la respuesta del envío se perdió: la propia vuelve por la bajada, con su marca corregida
        val corregida = marca(t0 - 1, yo, 7)
        val ajena = "018f3a6e-2000-7000-8000-000000000009"
        s.aplicarBajada(
            listOf(
                OpDelServidor(a.opId, a.tipo, a.entidadTipo, a.entidadId, corregida, a.payload, 1, ++seq),
                delServidor("expense.create", "expense", ajena, null, marca(t0, otro)), // redactada: la purgaron después
                delServidor("expense.purge", "expense", ajena, null, marca(t0 + 1, otro)),
            ),
            hora,
        )
        assertEquals(EstadoOp.CONFIRMADA to corregida, c.buscarEnCola(a.opId)!!.let { it.estado to it.op.hlc })
        assertTrue("la ajena purgada queda terminada", c.entidadTerminada("expense", ajena))
        assertEquals(seq, c.viajeLocal()!!.ultimoSeq)
        // repetir la página no cambia nada
        val antes = c.instantanea()
        s.aplicarBajada(listOf(OpDelServidor(a.opId, a.tipo, a.entidadTipo, a.entidadId, corregida, a.payload, 1, seq - 2)), hora)
        assertEquals(antes, c.instantanea())
        assertEquals("la última secuencia no retrocede", seq, c.viajeLocal()!!.ultimoSeq)
    }

    private val dueno = "018f3a6e-2000-7000-8000-000000000005"
    private val adjunto = "018f3a6e-aaaa-7000-8000-000000000001"
    private val altaDeGasto = """{"monto_minor":5,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18"}"""
    private val altaDeAdjunto = """{"owner_tipo":"EXPENSE","owner_id":"018f3a6e-2000-7000-8000-000000000005","mime":"image/png","bytes":5,"sha256":"${"ab".repeat(32)}","tiene_miniatura":0}"""

    @Test
    fun unAdjuntoRedactadoGuardaSuDuenoYNaceTerminadoSiElDuenoYaSePurgo() {
        val (c, s) = celular()
        s.aplicarBajada(
            listOf(
                delServidor("expense.create", "expense", dueno, null, marca(t0, otro)),
                delServidor("expense.purge", "expense", dueno, null, marca(t0 + 1, otro)),
                delServidor("attachment.add", "attachment", adjunto, null, marca(t0 + 2, otro)).copy(padreId = dueno),
            ),
            hora,
        )
        assertEquals(dueno, c.buscarEnCola(c.opsDeEntidad("attachment", adjunto).single().op.opId)!!.op.padreId)
        assertTrue(c.entidadTerminada("attachment", adjunto))
    }

    @Test
    fun purgarUnDuenoTerminaTambienLosAdjuntosQueSoloSeConocenPorUnaOpRedactada() {
        val (c, s) = celular()
        s.aplicarBajada(
            listOf(
                delServidor("expense.create", "expense", dueno, null, marca(t0, otro)),
                delServidor("attachment.add", "attachment", adjunto, null, marca(t0 + 1, otro)).copy(padreId = dueno),
                delServidor("expense.purge", "expense", dueno, null, marca(t0 + 2, otro)),
            ),
            hora,
        )
        assertTrue(c.entidadTerminada("attachment", adjunto))
    }

    @Test
    fun descartarUnAdjuntoPropioCuyoDuenoPurgoOtroNoDejaUnaLapidaQueElServidorNoTiene() {
        val (c, s) = celular()
        s.aplicarBajada(listOf(delServidor("expense.create", "expense", dueno, altaDeGasto, marca(t0, otro))), hora)
        val add = Operacion(opId(), "attachment.add", "attachment", adjunto, s.nuevaMarca(), json(altaDeAdjunto), 1)
        s.registrar(add)
        s.aplicarBajada(listOf(delServidor("expense.purge", "expense", dueno, null, marca(t0 + 2, otro))), hora)
        assertTrue(c.entidadTerminada("attachment", adjunto))
        s.armarLote()
        s.respuestaDelLote(listOf(RespuestaDeOp(add.opId, false, null, add.hlc, "limite_superado")), hora)
        s.descartar(add.opId)
        assertFalse(c.entidadTerminada("attachment", adjunto))
    }

    @Test
    fun unaAjenaQueElMotorNoPuedeAplicarSeGuardaConSusDatos() {
        val (c, s) = celular()
        s.aplicarBajada(listOf(delServidor("expense.create", "expense", dueno, altaDeGasto, marca(t0, otro))), hora)
        // un alta propia del mismo adjunto con otro dueño (no pasa con ids nuevos, pero el celular no debe perder la ajena)
        val otroDueno = "018f3a6e-2000-7000-8000-000000000006"
        s.aplicarBajada(listOf(delServidor("expense.create", "expense", otroDueno, altaDeGasto, marca(t0, otro, 1))), hora)
        val propia = Operacion(opId(), "attachment.add", "attachment", adjunto, s.nuevaMarca(), json(altaDeAdjunto.replace(dueno, otroDueno)), 1)
        s.registrar(propia)
        s.aplicarBajada(listOf(delServidor("attachment.add", "attachment", adjunto, altaDeAdjunto, marca(t0 + 5, otro)).copy(padreId = dueno)), hora)
        val ajena = c.opsDeEntidad("attachment", adjunto).first { it.op.opId != propia.opId }
        assertEquals(json(altaDeAdjunto), ajena.op.payload)
        assertEquals(EstadoOp.CONFIRMADA, ajena.estado)
        // rechazada y descartada la propia, queda la del servidor
        s.armarLote()
        s.respuestaDelLote(listOf(RespuestaDeOp(propia.opId, false, null, propia.hlc, "formato")), hora)
        s.descartar(propia.opId)
        assertEquals(JsonPrimitive(dueno), c.leerCampo("attachment", adjunto, "owner_id"))
    }

    @Test
    fun verUnaMarcaAjenaAdelantaLaProximaPropia() {
        val (_, s) = celular()
        s.aplicarBajada(listOf(delServidor("expense.create", "expense", gasto, """{"monto_minor":5,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1,"dia_imputado":"2027-02-18"}""", marca(t0 + 60_000, otro, 4))), t0)
        val m = Reloj.parsear(s.nuevaMarca())!!
        assertTrue(m.ms > t0 + 60_000 || (m.ms == t0 + 60_000 && m.contador > 4))
    }
}
