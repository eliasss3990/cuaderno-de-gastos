package com.eliasgonzalez.cuadernodegastos.red

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenMemoria
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado as ResultadoDelMotor
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Ciclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCanal
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.ViajeLocal
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * La app contra el servidor de verdad (no uno de prueba): crear el viaje, invitar, unirse, sincronizar varios celulares
 * y el canal en vivo. Corre solo con `-PservidorDePrueba=http://…` (un servidor recién levantado y vacío).
 */
class ServidorRealTest {
    private val base = System.getProperty("servidor.de.prueba").orEmpty()
    private val identidad = ClienteDeIdentidad(base, "1.0.0")
    private fun json(s: String) = Json.parseToJsonElement(s).jsonObject

    private inner class Celular(val c: Credenciales) {
        val cola = AlmacenMemoria().also { it.guardarViajeLocal(ViajeLocal(c.dispositivo, c.integrante)) }
        val sinc = Sincronizador(cola) { System.currentTimeMillis() }
        val ciclo = Ciclo(sinc, cola, ClienteHttp(base, c.viaje, { c.token }, "1.0.0", { EstadoDelCelular(cola.viajeLocal()!!.ultimoSeq, cola.enEstado(EstadoOp.PENDIENTE).size) }), { System.currentTimeMillis() })

        fun alDia() {
            repeat(5) { if (ciclo.correr() == FinDelCiclo.AlDia) return }
            error("no se puso al día")
        }

        fun gasto(monto: Int, nota: String): String {
            val id = uuid7()
            val r = sinc.registrar(Operacion(uuid7(), "expense.create", "expense", id, sinc.nuevaMarca(), json("""{"monto_minor":$monto,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":${System.currentTimeMillis()},"dia_imputado":"2027-02-18","nota":"$nota"}"""), 1))
            // que se guarde de verdad (antes de bajar el viaje se rechazaría: no conoce la moneda)
            check(r is ResultadoDelMotor.Aceptada) { "gasto rechazado: $r" }
            return id
        }
    }

    /** Un UUID v7 (lo que generan los celulares): hora arriba, azar abajo. */
    private fun uuid7(): String {
        val r = UUID.randomUUID()
        val alto = (System.currentTimeMillis() shl 16) or 0x7000L or (r.mostSignificantBits and 0x0FFFL)
        return UUID(alto, (r.leastSignificantBits and 0x3FFFFFFFFFFFFFFFL) or Long.MIN_VALUE).toString()
    }

    private fun <T> ok(r: Resultado<T>): T = (r as? Resultado.Ok<T>)?.valor ?: error("esperaba Ok y fue $r")

    @Test
    fun crearInvitarUnirseYSincronizarContraElServidorReal() {
        assumeTrue("sin -PservidorDePrueba: esta prueba no corre", base.isNotEmpty())
        val yo = Perfil("Pixel", "Eli", "#E8E4F3", "🙂")
        val a = Celular(ok(identidad.crearViaje(ViajeNuevo("Brasil", "America/Sao_Paulo", listOf(MonedaNueva("PYG", 0, "₲"), MonedaNueva("BRL", 2, "R$"))), yo)))
        a.alDia()
        // bajó lo que escribió el servidor al crear el viaje: el viaje y el alta del organizador
        assertEquals(listOf("trip.create", "member.join"), a.cola.opsDesde(0, 100).map { it.op.tipo })

        val codigoDeB = ok(identidad.invitar(a.c)).codigo
        val b = Celular(ok(identidad.unirse(codigoDeB, Perfil("Moto", "Ana", "#F3E4E4", "🌵"))))
        assertEquals(a.c.viaje, b.c.viaje)
        // si la respuesta se hubiera perdido, repetir el mismo código da "código inválido" (por eso no se reintenta solo)
        assertEquals(Rechazo.CODIGO_INVALIDO, (identidad.unirse(codigoDeB, Perfil("Moto", "Ana", "#F3E4E4", "🌵")) as Resultado.Rechazado).motivo)

        // b escucha el canal en vivo mientras a carga
        val avisos = LinkedBlockingQueue<Long>()
        val fines = LinkedBlockingQueue<FinDelCanal>()
        val escucha = CanalEnHilo { CanalEnVivo(base, b.c.viaje, { b.c.token }, "1.0.0") }.abrir({ avisos.add(it) }, { fines.add(it) })
        val cabezaAlConectar = avisos.poll(10, TimeUnit.SECONDS)!!
        b.alDia()

        val deA = List(6) { a.gasto(1000 + it, "ñandú 😀 $it") }
        val deB = List(4) { b.gasto(2000 + it, "b$it") }
        a.alDia()
        // el aviso llega con una cabeza mayor
        var aviso = avisos.poll(10, TimeUnit.SECONDS)!!
        while (aviso <= cabezaAlConectar) aviso = avisos.poll(10, TimeUnit.SECONDS)!!
        for (c in listOf(b, a, b)) c.alDia()
        assertEquals(a.cola.instantanea(), b.cola.instantanea())
        // cada celular sabe quién cargó cada gasto (el servidor lo saca del token)
        for (c in listOf(a, b)) {
            deA.forEach { assertEquals(a.c.integrante, c.cola.autorDe("expense", it)) }
            deB.forEach { assertEquals(b.c.integrante, c.cola.autorDe("expense", it)) }
        }
        assertEquals(a.cola.viajeLocal()!!.ultimoSeq, b.cola.viajeLocal()!!.ultimoSeq)
        assertTrue(a.cola.enEstado(EstadoOp.PENDIENTE).isEmpty() && b.cola.enEstado(EstadoOp.CUARENTENA).isEmpty())
        // corta a más tardar con el próximo latido (cada 20 s)
        escucha.cancelar()
        assertEquals(FinDelCanal.DETENIDO, fines.poll(30, TimeUnit.SECONDS))

        // un código que no existe no sirve; un viaje con 4 celulares no admite otro
        assertEquals(Rechazo.CODIGO_INVALIDO, (identidad.unirse("XXXX-XXXX", yo) as Resultado.Rechazado).motivo)
        repeat(2) { ok(identidad.unirse(ok(identidad.invitar(a.c)).codigo, Perfil("Otro$it", "O$it", "#E4F3E4", "🐢"))) }
        val quinto = identidad.unirse(ok(identidad.invitar(a.c)).codigo, Perfil("Quinto", "Q", "#E4F3E4", "🐢"))
        assertEquals(Rechazo.VIAJE_COMPLETO, (quinto as Resultado.Rechazado).motivo)
        // solo quien organiza invita
        assertEquals(Rechazo.SOLO_ORGANIZADOR, (identidad.invitar(b.c) as Resultado.Rechazado).motivo)
        // un token que no es del viaje: el ciclo termina revocado
        val intruso = Celular(Credenciales(a.c.viaje, uuid7(), a.c.integrante, "no-es-un-token"))
        assertEquals(FinDelCiclo.Revocado, intruso.ciclo.correr())
    }
}
