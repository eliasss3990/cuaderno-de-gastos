package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.base.Hlc
import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Recepcion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ResultadoDeOperacion
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

/**
 * Varios celulares y un servidor de prueba (la misma recepción que el servidor) con una red que pierde pedidos y
 * respuestas, relojes desfasados, ediciones a la vez, purgas, cierres y límites. Con una semilla se reproduce igual. Al
 * final, con la cola vacía y lo que quedó en cuarentena descartado, cada celular tiene el mismo estado que el servidor.
 */
class SimuladorTest {
    private val viaje = "018f3a6e-1000-7000-8000-000000000001"

    private class Servidor(var hora: Long) {
        val almacen = AlmacenMemoria()
        val recepcion = Recepcion(almacen) { hora }
    }

    private inner class Celular(val dispositivo: String, val integrante: String, val desfase: Long, servidor: Servidor) {
        val almacen = AlmacenMemoria()
        val sinc = Sincronizador(almacen) { servidor.hora + desfase }

        init {
            almacen.guardarViajeLocal(ViajeLocal(dispositivo, integrante))
        }
    }

    private fun json(s: String) = Json.parseToJsonElement(s).jsonObject

    private fun uid(grupo: String, n: Int) = "018f3a6e-$grupo-7000-8000-${n.toString().padStart(12, '0')}"

    private class Contador {
        var n = 0
    }

    private fun simular(semilla: Long, pasos: Int): Int {
        val azar = Random(semilla)
        val t0 = 1_802_000_000_000L
        val servidor = Servidor(t0)
        val opIds = Contador()
        fun opId() = uid("9000", ++opIds.n)
        val dispositivos = (1..3).map { "018f3a6e-0000-7000-8000-00000000000$it" }
        // el alta del viaje y de los integrantes la escribe el servidor
        val alta = Operacion(opId(), "trip.create", "trip", viaje, Reloj.formatear(Hlc(t0 - 1000, 0, dispositivos[0])), json("""{"nombre":"V","zona_horaria":"America/Asuncion","monedas":[{"codigo":"PYG","decimales":0,"simbolo":"₲"}]}"""), 1)
        servidor.recepcion.procesarLote(listOf(alta), dispositivos[0])
        dispositivos.forEachIndexed { i, d ->
            val m = Operacion(opId(), "member.join", "member", uid("0b00", i + 1), Reloj.formatear(Hlc(t0 - 1000, 1, d)), json("""{"apodo":"P$i","color":"#FFE2B8","emoji":"x","es_organizador":${if (i == 0) 1 else 0}}"""), 1)
            servidor.recepcion.procesarLote(listOf(m), d)
        }
        // un celular con el reloj 10 minutos adelantado, otro atrasado
        val desfases = listOf(0L, 600_000L, -90_000L)
        val celulares = dispositivos.mapIndexed { i, d -> Celular(d, uid("0b00", i + 1), desfases[i], servidor) }

        // como en la app, cada alta tiene un id nuevo (UUID): nadie crea con el id de otro; las ediciones van a lo que se ve
        val ids = Contador()
        fun nuevo(grupo: String) = uid(grupo, ++ids.n)
        var entregadas = 0

        fun bajar(c: Celular) {
            while (true) {
                val desde = c.almacen.viajeLocal()!!.ultimoSeq
                val pagina = servidor.almacen.opsDesde(desde, 1 + azar.nextInt(20))
                if (pagina.isEmpty()) return
                val ops = pagina.map { OpDelServidor(it.op.opId, it.op.tipo, it.op.entidadTipo, it.op.entidadId, it.op.hlc, it.op.payload, it.op.schemaVersion, it.seq, it.op.padreId) }
                // a veces la respuesta se pierde: la página se repite la próxima vez
                if (azar.nextInt(8) == 0) return
                c.sinc.aplicarBajada(ops, servidor.hora)
            }
        }

        // a veces se reintenta enseguida y a veces con una espera (medida con el reloj del celular, que respeta el orden)
        fun espera(c: Celular): Long? = if (azar.nextBoolean()) null else servidor.hora + c.desfase + azar.nextInt(20_000)

        fun subir(c: Celular) {
            val lote = c.sinc.armarLote(1 + azar.nextInt(10))
            if (lote.isEmpty()) return
            val ops = lote.map { Operacion(it.opId, it.tipo, it.entidadTipo, it.entidadId, it.hlc, it.payload ?: JsonObject(emptyMap()), it.schemaVersion) }
            if (azar.nextInt(6) == 0) {
                c.sinc.loteNoEnviado(lote.map { it.opId }, espera(c)) // el pedido no llegó
                return
            }
            val resultados = servidor.recepcion.procesarLote(ops, c.dispositivo)
            entregadas += resultados.size
            if (azar.nextInt(6) == 0) {
                c.sinc.loteNoEnviado(lote.map { it.opId }, espera(c)) // llegó, pero la respuesta se perdió
                return
            }
            c.sinc.respuestaDelLote(
                resultados.map { RespuestaDeOp(it.opId, it.estado != ResultadoDeOperacion.Estado.RECHAZADA, it.seq, it.hlc, it.razon?.codigo) },
                servidor.hora,
            )
        }

        fun s(v: String) = JsonPrimitive(v)

        fun editar(c: Celular) {
            val a = c.almacen
            val conocidos = a.instantanea()["entidades"].let { it as kotlinx.serialization.json.JsonArray }
                .map { it.jsonObject }.filter { (it["tipo"] as JsonPrimitive).content == "expense" }.map { (it["id"] as JsonPrimitive).content }
            val categorias = a.instantanea()["entidades"].let { it as kotlinx.serialization.json.JsonArray }
                .map { it.jsonObject }.filter { (it["tipo"] as JsonPrimitive).content == "category" }.map { (it["id"] as JsonPrimitive).content }
            val adjuntos = a.instantanea()["entidades"].let { it as kotlinx.serialization.json.JsonArray }
                .map { it.jsonObject }.filter { (it["tipo"] as JsonPrimitive).content == "attachment" }.map { (it["id"] as JsonPrimitive).content }
            val payload: Pair<String, Map<String, JsonElement>>
            val r = azar.nextInt(14)
            val (tipo, entidad, id) = when {
                r < 3 || conocidos.isEmpty() -> {
                    val cat = if (categorias.isEmpty() || azar.nextBoolean()) "otro" else categorias[azar.nextInt(categorias.size)]
                    payload = "x" to mapOf("monto_minor" to JsonPrimitive(1 + azar.nextInt(500)), "moneda" to s("PYG"), "categoria_id" to s(cat), "cuando_ocurrio" to JsonPrimitive(t0), "dia_imputado" to s("2027-02-18"))
                    Triple("expense.create", "expense", nuevo("2000"))
                }
                r < 7 -> {
                    payload = "x" to mapOf(listOf("concepto", "lugar", "nota")[azar.nextInt(3)] to if (azar.nextInt(5) == 0) JsonNull else s("t${azar.nextInt(100)}"))
                    Triple("expense.update", "expense", conocidos[azar.nextInt(conocidos.size)])
                }
                r < 8 -> { payload = "x" to mapOf("eliminado" to JsonPrimitive(1)); Triple("expense.delete", "expense", conocidos[azar.nextInt(conocidos.size)]) }
                r < 9 -> { payload = "x" to mapOf("eliminado" to JsonPrimitive(0)); Triple("expense.restore", "expense", conocidos[azar.nextInt(conocidos.size)]) }
                r < 10 -> { payload = "x" to emptyMap(); Triple("expense.purge", "expense", conocidos[azar.nextInt(conocidos.size)]) }
                r < 11 -> { payload = "x" to mapOf("nombre" to s("C"), "color" to s("#E8E4F3"), "emoji" to s("x")); Triple("category.create", "category", nuevo("7000")) }
                r < 12 -> {
                    val dueno = conocidos[azar.nextInt(conocidos.size)]
                    payload = "x" to mapOf("owner_tipo" to s("EXPENSE"), "owner_id" to s(dueno), "mime" to s("image/png"), "bytes" to JsonPrimitive(5), "sha256" to s("ab".repeat(32)), "tiene_miniatura" to JsonPrimitive(0))
                    Triple("attachment.add", "attachment", nuevo("aaaa"))
                }
                r < 13 && adjuntos.isNotEmpty() && azar.nextBoolean() -> { payload = "x" to mapOf("quitado" to JsonPrimitive(1)); Triple("attachment.remove", "attachment", adjuntos[azar.nextInt(adjuntos.size)]) }
                r < 13 -> { payload = "x" to mapOf("estado_manual" to if (azar.nextInt(3) == 0) s("CERRADO") else JsonNull); Triple("trip.update", "trip", viaje) }
                r < 14 && azar.nextBoolean() -> {
                    // atajos (tope de 6) y una moneda nueva que después usan los gastos
                    if (azar.nextBoolean()) {
                        payload = "x" to mapOf("nombre" to s("A"), "monto_minor" to JsonPrimitive(5), "moneda" to s("PYG"), "categoria_id" to s("otro"), "orden" to JsonPrimitive(1))
                        Triple("shortcut.create", "shortcut", nuevo("5555"))
                    } else {
                        payload = "x" to mapOf("habilitada" to JsonPrimitive(1), "decimales" to JsonPrimitive(2), "simbolo" to s("$"))
                        Triple("currency.enable", "trip_currency", "USD")
                    }
                }
                else -> {
                    val moneda = if (a.entidadExiste("trip_currency", "USD") && azar.nextBoolean()) "USD" else "PYG"
                    payload = "x" to mapOf("concepto" to s("misma"), "moneda" to s(moneda))
                    Triple("expense.update", "expense", conocidos[azar.nextInt(conocidos.size)])
                }
            }
            c.sinc.registrar(Operacion(opId(), tipo, entidad, id, c.sinc.nuevaMarca(), JsonObject(payload.second), 1))
        }

        repeat(pasos) {
            servidor.hora += azar.nextInt(5_000).toLong()
            val c = celulares[azar.nextInt(celulares.size)]
            when (azar.nextInt(10)) {
                in 0..4 -> editar(c)
                in 5..6 -> subir(c)
                in 7..8 -> bajar(c)
                else -> {
                    // alguien revisa la cuarentena: reintenta o descarta una
                    val q = c.almacen.enEstado(EstadoOp.CUARENTENA).firstOrNull()
                    if (q != null) if (azar.nextBoolean()) c.sinc.reintentar(q.op.opId) else c.sinc.descartar(q.op.opId)
                }
            }
        }

        // sana la red: pasa el tiempo de las esperas y todos suben y bajan hasta vaciar la cola; lo que queda en cuarentena
        // se descarta
        servidor.hora += 60_000
        repeat(50) {
            for (c in celulares) {
                for (q in c.almacen.enEstado(EstadoOp.CUARENTENA)) if (c.almacen.buscarEnCola(q.op.opId)?.estado == EstadoOp.CUARENTENA) c.sinc.descartar(q.op.opId)
                while (true) {
                    val lote = c.sinc.armarLote()
                    if (lote.isEmpty()) break
                    val ops = lote.map { Operacion(it.opId, it.tipo, it.entidadTipo, it.entidadId, it.hlc, it.payload ?: JsonObject(emptyMap()), it.schemaVersion) }
                    val res = servidor.recepcion.procesarLote(ops, c.dispositivo)
                    c.sinc.respuestaDelLote(res.map { RespuestaDeOp(it.opId, it.estado != ResultadoDeOperacion.Estado.RECHAZADA, it.seq, it.hlc, it.razon?.codigo) }, servidor.hora)
                }
            }
            for (c in celulares) {
                while (true) {
                    val desde = c.almacen.viajeLocal()!!.ultimoSeq
                    val pagina = servidor.almacen.opsDesde(desde, 200)
                    if (pagina.isEmpty()) break
                    c.sinc.aplicarBajada(pagina.map { OpDelServidor(it.op.opId, it.op.tipo, it.op.entidadTipo, it.op.entidadId, it.op.hlc, it.op.payload, it.op.schemaVersion, it.seq, it.op.padreId) }, servidor.hora)
                }
            }
        }
        for (c in celulares) {
            val quedan = EstadoOp.entries.filter { it != EstadoOp.CONFIRMADA }.flatMap { c.almacen.enEstado(it) }
            assertEquals("semilla $semilla: cola de ${c.dispositivo}: ${quedan.take(3).map { "${it.op.tipo} ${it.estado} ${it.razon} intentos=${it.intentos} prox=${it.proximoIntentoEn} hora=${servidor.hora}" }}", 0, quedan.size)
            val esperado = servidor.almacen.instantanea()
            val obtenido = c.almacen.instantanea()
            if (esperado != obtenido) throw AssertionError("semilla $semilla, ${c.dispositivo}: ${diferencia(esperado, obtenido)}")
        }
        return entregadas
    }

    /** La primera diferencia entre dos instantáneas, corta, para el mensaje. */
    private fun diferencia(a: JsonObject, b: JsonObject): String {
        for (k in listOf("entidades", "lapidas", "ops")) {
            val x = (a[k] as kotlinx.serialization.json.JsonArray).map { it.toString() }.toSet()
            val y = (b[k] as kotlinx.serialization.json.JsonArray).map { it.toString() }.toSet()
            if (x != y) return "$k: solo en el servidor ${(x - y).take(2)}; solo en el celular ${(y - x).take(2)}"
        }
        return "?"
    }

    @Test
    fun todosLosCelularesConvergenAlServidor() {
        var entregadas = 0
        for (semilla in 1L..60L) entregadas += simular(semilla, 400)
        assertTrue("se entregaron $entregadas operaciones", entregadas > 3000)
    }
}
