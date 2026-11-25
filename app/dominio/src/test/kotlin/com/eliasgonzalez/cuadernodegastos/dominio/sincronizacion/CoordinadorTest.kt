package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** Tiempo virtual: las acciones corren en orden de hora y, a igual hora, de llegada. */
private class PlanificadorDePrueba : Planificador {
    var ahora = 0L
    private var orden = 0
    private val pendientes = mutableListOf<Triple<Long, Int, () -> Unit>>()

    override fun despues(ms: Long, accion: () -> Unit): Cancelable {
        val t = Triple(ahora + ms, orden++, accion)
        pendientes += t
        return Cancelable { pendientes.remove(t) }
    }

    override fun <T> aparte(trabajo: () -> T, luego: (T) -> Unit) {
        val r = trabajo()
        despues(0) { luego(r) }
    }

    /** Avanza el reloj corriendo todo lo que vence hasta `hasta`. */
    fun avanzar(ms: Long) {
        val hasta = ahora + ms
        while (true) {
            val p = pendientes.filter { it.first <= hasta }.minWithOrNull(compareBy({ it.first }, { it.second })) ?: break
            pendientes.remove(p)
            ahora = p.first
            p.third()
        }
        ahora = hasta
    }
}

private class CanalDePrueba : Canal {
    inner class Escucha(val alNovedad: (Long) -> Unit, val alTerminar: (FinDelCanal) -> Unit) {
        var cancelada = false
    }

    val escuchas = mutableListOf<Escucha>()
    val abierta get() = escuchas.lastOrNull()?.takeIf { !it.cancelada }

    override fun abrir(alNovedad: (cabeza: Long) -> Unit, alTerminar: (FinDelCanal) -> Unit): Cancelable {
        val e = Escucha(alNovedad, alTerminar)
        escuchas += e
        return Cancelable { e.cancelada = true }
    }
}

class CoordinadorTest {
    private val plan = PlanificadorDePrueba()
    private val canal = CanalDePrueba()
    private val fines = ArrayDeque<FinDelCiclo>()
    private var ciclos = 0
    private var romper = false
    private var ultimoSeq = 0L
    private val estados = mutableListOf<EstadoDeSincronizacion>()
    private val c = Coordinador(
        ciclo = {
            ciclos++
            if (romper) {
                romper = false
                throw IllegalStateException("la base falló")
            }
            fines.removeFirstOrNull() ?: FinDelCiclo.AlDia
        },
        canal = canal,
        planificador = plan,
        ultimoSeq = { ultimoSeq },
        alCambiarEstado = { estados += it },
        // con este azar la espera es siempre la mínima de cada tramo: las horas de las pruebas son exactas
        azar = object : Random() {
            override fun nextBits(bitCount: Int) = 0
        },
    )

    private fun enPantalla() {
        c.alPrimerPlano()
        plan.avanzar(0)
    }

    @Test
    fun enPantallaAbreElCanalYSincroniza() {
        enPantalla()
        c.alCambioLocal()
        plan.avanzar(0)
        assertEquals(1, canal.escuchas.size)
        assertEquals(2, ciclos)
        assertEquals(listOf(EstadoDeSincronizacion.Sincronizando, EstadoDeSincronizacion.AlDia, EstadoDeSincronizacion.Sincronizando, EstadoDeSincronizacion.AlDia), estados)
    }

    @Test
    fun unAvisoConAlgoNuevoSincronizaYUnoViejoNo() {
        enPantalla()
        ultimoSeq = 5
        canal.abierta!!.alNovedad(5)
        plan.avanzar(0)
        assertEquals(1, ciclos)
        canal.abierta!!.alNovedad(6)
        plan.avanzar(0)
        assertEquals(2, ciclos)
    }

    @Test
    fun unPedidoMientrasCorreUnCicloSeHaceDespuesYUnaSolaVez() {
        enPantalla()
        c.alCambioLocal()
        c.alCambioLocal()
        c.alCambioLocal()
        // los tres llegaron con el ciclo andando (el fin todavía no volvió al hilo)
        assertEquals(2, ciclos)
        plan.avanzar(0)
        assertEquals(3, ciclos)
        plan.avanzar(60_000)
        assertEquals(3, ciclos)
    }

    @Test
    fun unReintentoEsperaLoQueDiceElCicloYUnCambioLoAdelanta() {
        fines += FinDelCiclo.Reintentar(5_000)
        enPantalla()
        assertEquals(EstadoDeSincronizacion.SinConexion, estados.last())
        plan.avanzar(4_999)
        assertEquals(1, ciclos)
        plan.avanzar(1)
        assertEquals(2, ciclos)
        assertEquals(EstadoDeSincronizacion.AlDia, estados.last())
        // un cambio local antes de que venza: corre ya y el reintento programado se cancela
        fines += FinDelCiclo.Reintentar(5_000)
        c.alCambioLocal()
        plan.avanzar(1_000)
        assertEquals(3, ciclos)
        c.alCambioLocal()
        plan.avanzar(10_000)
        assertEquals(4, ciclos)
    }

    @Test
    fun unReintentoInmediatoNoMuestraSinConexion() {
        fines += FinDelCiclo.Reintentar(0)
        enPantalla()
        assertEquals(2, ciclos)
        // ni repite "sincronizando" al encadenar el segundo ciclo
        assertEquals(listOf(EstadoDeSincronizacion.Sincronizando, EstadoDeSincronizacion.AlDia), estados)
    }

    @Test
    fun elCanalCortadoReconectaConEsperaYTrasVariosCortesConsultaCadaMinuto() {
        enPantalla()
        canal.abierta!!.alTerminar(FinDelCanal.CORTADO)
        plan.avanzar(499)
        assertEquals(1, canal.escuchas.size)
        plan.avanzar(1) // primera espera: 0,5 s con este azar
        assertEquals(2, canal.escuchas.size)
        canal.abierta!!.alTerminar(FinDelCanal.CORTADO)
        plan.avanzar(1_000)
        assertEquals(3, canal.escuchas.size)
        // dos cortes todavía no suman la consulta
        plan.avanzar(120_000)
        assertEquals(1, ciclos)
        canal.abierta!!.alTerminar(FinDelCanal.CORTADO)
        plan.avanzar(2_000)
        assertEquals(4, canal.escuchas.size)
        // tercer corte: además del canal, un ciclo por minuto
        plan.avanzar(58_000)
        assertEquals(2, ciclos)
        plan.avanzar(60_000)
        assertEquals(3, ciclos)
        // el canal vuelve a avisar: la consulta se apaga
        canal.abierta!!.alNovedad(0)
        plan.avanzar(300_000)
        assertEquals(3, ciclos)
    }

    @Test
    fun conElCanalNoDisponibleConsultaDesdeElPrimerCorte() {
        enPantalla()
        canal.abierta!!.alTerminar(FinDelCanal.NO_DISPONIBLE)
        plan.avanzar(60_000)
        assertEquals(2, ciclos)
    }

    @Test
    fun enSegundoPlanoCierraElCanalALos30sSalvoQueVuelva() {
        enPantalla()
        c.alSegundoPlano()
        plan.avanzar(20_000)
        c.alPrimerPlano()
        plan.avanzar(60_000)
        assertFalse(canal.escuchas[0].cancelada)
        assertEquals(1, canal.escuchas.size)
        c.alSegundoPlano()
        plan.avanzar(30_000)
        assertTrue(canal.escuchas[0].cancelada)
        // cerrado no reconecta ni consulta
        val ciclosAntes = ciclos
        plan.avanzar(600_000)
        assertEquals(1, canal.escuchas.size)
        assertEquals(ciclosAntes, ciclos)
        // al volver se abre otro y sincroniza
        enPantalla()
        assertEquals(2, canal.escuchas.size)
        assertEquals(ciclosAntes + 1, ciclos)
    }

    @Test
    fun irYVolverYOtraVezIrDaLos30sDesdeLaUltimaSalida() {
        enPantalla()
        c.alSegundoPlano()
        plan.avanzar(20_000)
        c.alPrimerPlano()
        plan.avanzar(5_000)
        c.alSegundoPlano()
        plan.avanzar(29_999)
        assertFalse(canal.escuchas[0].cancelada)
        plan.avanzar(1)
        assertTrue(canal.escuchas[0].cancelada)
    }

    @Test
    fun alCerrarseCancelaLaReconexionPendienteYAlVolverAbreYa() {
        enPantalla()
        // siete cortes: la próxima reconexión queda a 32 s
        repeat(7) {
            canal.abierta!!.alTerminar(FinDelCanal.CORTADO)
            plan.avanzar(if (it < 6) 16_000 else 0)
        }
        assertEquals(7, canal.escuchas.size)
        c.alSegundoPlano()
        plan.avanzar(30_000)
        enPantalla()
        assertEquals(8, canal.escuchas.size)
        // y la espera empieza de nuevo: el próximo corte reconecta en 0,5 s
        canal.abierta!!.alTerminar(FinDelCanal.CORTADO)
        plan.avanzar(500)
        assertEquals(9, canal.escuchas.size)
    }

    @Test
    fun laConsultaSigueEnLosSegundosDeGraciaYParaAlCerrar() {
        enPantalla()
        canal.abierta!!.alTerminar(FinDelCanal.NO_DISPONIBLE)
        plan.avanzar(40_000)
        c.alSegundoPlano()
        plan.avanzar(20_000)
        assertEquals(2, ciclos)
        plan.avanzar(600_000)
        assertEquals(2, ciclos)
    }

    @Test
    fun losTiemposSePuedenAcortar() {
        var n = 0
        val corto = Coordinador({ n++; FinDelCiclo.AlDia }, canal, plan, { 0 }, { }, tiempos = TiemposDelCoordinador(cierreEnSegundoPlanoMs = 2_000, consultaDeRespaldoMs = 3_000))
        corto.alPrimerPlano()
        plan.avanzar(0)
        // la consulta de respaldo cada 3 s
        canal.abierta!!.alTerminar(FinDelCanal.NO_DISPONIBLE)
        plan.avanzar(2_999)
        assertEquals(1, n)
        plan.avanzar(1)
        assertEquals(2, n)
        // el cierre a los 2 s de pasar a segundo plano (el canal se reabrió tras la espera)
        val abierta = canal.abierta!!
        corto.alSegundoPlano()
        plan.avanzar(1_999)
        assertFalse(abierta.cancelada)
        plan.avanzar(1)
        assertTrue(abierta.cancelada)
    }

    @Test
    fun cortadoEnSegundoPlanoNoReconecta() {
        enPantalla()
        c.alSegundoPlano()
        canal.abierta!!.alTerminar(FinDelCanal.CORTADO)
        plan.avanzar(600_000)
        assertEquals(1, canal.escuchas.size)
    }

    @Test
    fun losAvisosDeUnaEscuchaViejaSeIgnoran() {
        enPantalla()
        val vieja = canal.escuchas[0]
        c.alSegundoPlano()
        plan.avanzar(30_000)
        enPantalla()
        assertEquals(2, ciclos)
        // la vieja termina tarde (DETENIDO o CORTADO) y avisa algo: nada cambia
        vieja.alNovedad(99)
        vieja.alTerminar(FinDelCanal.CORTADO)
        plan.avanzar(600_000)
        assertEquals(2, ciclos)
        assertEquals(2, canal.escuchas.size)
        assertFalse(canal.escuchas[1].cancelada)
    }

    @Test
    fun revocadoDetieneTodoYNoVuelveAArrancar() {
        enPantalla()
        fines += FinDelCiclo.Revocado
        c.alCambioLocal()
        plan.avanzar(0)
        assertEquals(EstadoDeSincronizacion.Revocado, estados.last())
        assertTrue(canal.escuchas[0].cancelada)
        c.alCambioLocal()
        c.alPrimerPlano()
        c.sincronizarAhora()
        plan.avanzar(3_600_000)
        assertEquals(2, ciclos)
        assertEquals(1, canal.escuchas.size)
    }

    @Test
    fun appDesactualizadaTambienDetieneYCancelaElReintento() {
        fines += FinDelCiclo.Reintentar(5_000)
        enPantalla()
        fines += FinDelCiclo.AppDesactualizada
        c.sincronizarAhora()
        plan.avanzar(3_600_000)
        assertEquals(2, ciclos)
        assertEquals(EstadoDeSincronizacion.AppDesactualizada, estados.last())
    }

    @Test
    fun elCanalRevocadoPideUnCicloQueLoConfirmaYNoReconecta() {
        enPantalla()
        fines += FinDelCiclo.Revocado
        canal.abierta!!.alTerminar(FinDelCanal.REVOCADO)
        plan.avanzar(600_000)
        assertEquals(2, ciclos)
        assertEquals(1, canal.escuchas.size)
        assertEquals(EstadoDeSincronizacion.Revocado, estados.last())
    }

    @Test
    fun unCicloQueLanzaSeMuestraComoErrorYNoTrabaLosSiguientes() {
        romper = true
        enPantalla()
        assertEquals(EstadoDeSincronizacion.Error, estados.last())
        c.alCambioLocal()
        plan.avanzar(0)
        assertEquals(2, ciclos)
        assertEquals(EstadoDeSincronizacion.AlDia, estados.last())
    }

    @Test
    fun unRevocadoDelCanalQueElCicloNoConfirmaReintentaElCanalYConsulta() {
        enPantalla()
        canal.abierta!!.alTerminar(FinDelCanal.REVOCADO)
        plan.avanzar(500)
        assertEquals(2, ciclos)
        assertEquals(2, canal.escuchas.size)
        plan.avanzar(60_000)
        assertEquals(3, ciclos)
    }

    @Test
    fun conElCanalVivoUnAvisoAdelantaElReintentoPorFaltaDeConexion() {
        enPantalla()
        fines += FinDelCiclo.Reintentar(600_000)
        c.alCambioLocal()
        plan.avanzar(0)
        assertEquals(EstadoDeSincronizacion.SinConexion, estados.last())
        canal.abierta!!.alNovedad(0)
        plan.avanzar(0)
        assertEquals(3, ciclos)
        assertEquals(EstadoDeSincronizacion.AlDia, estados.last())
    }

    @Test
    fun unErrorSeMuestraYNoSeReintentaSolo() {
        fines += FinDelCiclo.Error
        enPantalla()
        plan.avanzar(3_600_000)
        assertEquals(1, ciclos)
        assertEquals(EstadoDeSincronizacion.Error, estados.last())
        c.sincronizarAhora()
        plan.avanzar(0)
        assertEquals(2, ciclos)
        assertEquals(EstadoDeSincronizacion.AlDia, estados.last())
    }
}
