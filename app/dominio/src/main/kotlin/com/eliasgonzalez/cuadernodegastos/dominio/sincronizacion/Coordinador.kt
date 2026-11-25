// Quién dispara la sincronización mientras la app vive: un cambio local, un aviso del canal en vivo, un reintento o la
// consulta de respaldo. Con la app en pantalla mantiene abierto el canal y lo reconecta con espera; 30 s después de pasar
// a segundo plano lo cierra (de ahí en más, la tarea periódica del sistema). Todo corre en un solo hilo (el del
// planificador), así que no hay carreras: los avisos del canal y el fin de cada ciclo vuelven a ese hilo.
package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import kotlin.random.Random

/** Cómo terminó una escucha del canal en vivo. */
enum class FinDelCanal {
    /** El servidor cerró o se cortó la conexión: reconectar con espera. */
    CORTADO,

    /** 401: el dispositivo fue revocado. */
    REVOCADO,

    /** 426: hay que actualizar la app. */
    APP_DESACTUALIZADA,

    /** 503 (canal lleno) u otro error: reconectar más tarde o caer a la consulta periódica. */
    NO_DISPONIBLE,

    /** Quien escuchaba pidió cortar. */
    DETENIDO,
}

/** Algo que se puede cancelar o cerrar. */
fun interface Cancelable {
    fun cancelar()
}

/** El hilo del coordinador y su reloj. En la app, un ejecutor de un solo hilo; en las pruebas, tiempo virtual. */
interface Planificador {
    /** Corre `accion` en el hilo del coordinador dentro de `ms`. */
    fun despues(ms: Long, accion: () -> Unit): Cancelable

    /** Corre `trabajo` fuera del hilo del coordinador (bloquea: red y base) y entrega el resultado en él. */
    fun <T> aparte(trabajo: () -> T, luego: (T) -> Unit)
}

/** El canal en vivo: abre una escucha y avisa en cualquier hilo cada cabeza anunciada y cómo terminó. */
fun interface Canal {
    fun abrir(alNovedad: (cabeza: Long) -> Unit, alTerminar: (FinDelCanal) -> Unit): Cancelable
}

/** Lo que muestra el indicador de estado. */
sealed interface EstadoDeSincronizacion {
    data object AlDia : EstadoDeSincronizacion

    data object Sincronizando : EstadoDeSincronizacion

    /** Sin conexión con el servidor: se reintenta solo. */
    data object SinConexion : EstadoDeSincronizacion

    /** El servidor rechazó un pedido entero: se reintenta con el próximo cambio o aviso. */
    data object Error : EstadoDeSincronizacion

    /** Se detuvo del todo: hay que volver a vincular el celular. */
    data object Revocado : EstadoDeSincronizacion

    /** Se detuvo del todo: hay que actualizar la app. */
    data object AppDesactualizada : EstadoDeSincronizacion
}

class Coordinador(
    private val ciclo: () -> FinDelCiclo,
    private val canal: Canal,
    private val planificador: Planificador,
    /** Última secuencia aplicada en el celular, para saber si un aviso trae algo nuevo. */
    private val ultimoSeq: () -> Long,
    private val alCambiarEstado: (EstadoDeSincronizacion) -> Unit,
    private val azar: Random = Random.Default,
) {
    companion object {
        const val CIERRE_EN_SEGUNDO_PLANO_MS = 30_000L
        const val CONSULTA_DE_RESPALDO_MS = 60_000L

        /** Cortes seguidos del canal antes de sumar la consulta de respaldo. */
        const val CORTES_ANTES_DE_CONSULTAR = 3
    }

    private var enPantalla = false
    private var detenido: EstadoDeSincronizacion? = null
    private var estado: EstadoDeSincronizacion? = null

    private var escucha: Cancelable? = null

    /** Cada escucha tiene su número: los avisos de una escucha vieja (ya cerrada o reemplazada) se ignoran. */
    private var generacion = 0
    private var cortesSeguidos = 0
    private var reconexion: Cancelable? = null
    private var consulta: Cancelable? = null
    private var cierre: Cancelable? = null

    private var corriendo = false
    private var otraVez = false
    private var reintento: Cancelable? = null

    /** La app pasó a primer plano. */
    fun alPrimerPlano() {
        enPantalla = true
        cierre?.cancelar()
        cierre = null
        if (detenido != null) return
        if (escucha == null && reconexion == null) abrirCanal()
        pedirCiclo()
    }

    /** La app pasó a segundo plano: el canal se cierra si no vuelve en 30 s. */
    fun alSegundoPlano() {
        enPantalla = false
        if (cierre != null) return
        // volver a primer plano lo cancela
        cierre = planificador.despues(CIERRE_EN_SEGUNDO_PLANO_MS) {
            cierre = null
            cerrarCanal()
        }
    }

    /** Se guardó un cambio local: subirlo cuanto antes. */
    fun alCambioLocal() = pedirCiclo()

    /** Un ciclo pedido a mano (el botón de reintentar). Después de un rechazo, también vuelve a probar. */
    fun sincronizarAhora() = pedirCiclo()

    private fun pedirCiclo() {
        if (detenido != null) return
        if (corriendo) {
            otraVez = true
            return
        }
        reintento?.cancelar()
        reintento = null
        corriendo = true
        mostrar(EstadoDeSincronizacion.Sincronizando)
        planificador.aparte({
            // una falla inesperada (la base, un error de programación) no deja trabado el "ciclo corriendo"
            try {
                ciclo()
            } catch (_: Exception) {
                FinDelCiclo.Error
            }
        }) { alTerminarCiclo(it) }
    }

    private fun alTerminarCiclo(fin: FinDelCiclo) {
        corriendo = false
        when (fin) {
            FinDelCiclo.AlDia -> mostrar(EstadoDeSincronizacion.AlDia)
            FinDelCiclo.Error -> mostrar(EstadoDeSincronizacion.Error)
            FinDelCiclo.Revocado -> detener(EstadoDeSincronizacion.Revocado)
            FinDelCiclo.AppDesactualizada -> detener(EstadoDeSincronizacion.AppDesactualizada)
            is FinDelCiclo.Reintentar -> {
                // un reintento inmediato es que quedó algo cargado mientras tanto, no un problema de conexión
                if (fin.enMs > 0) mostrar(EstadoDeSincronizacion.SinConexion)
                if (!otraVez) reintento = planificador.despues(fin.enMs) {
                    reintento = null
                    pedirCiclo()
                }
            }
        }
        if (otraVez) {
            otraVez = false
            pedirCiclo()
        }
    }

    private fun abrirCanal() {
        val mia = ++generacion
        escucha = canal.abrir(
            { cabeza -> planificador.despues(0) { if (mia == generacion) alNovedad(cabeza) } },
            { fin -> planificador.despues(0) { if (mia == generacion) alTerminarCanal(fin) } },
        )
    }

    private fun alNovedad(cabeza: Long) {
        // el canal funciona: la consulta de respaldo sobra
        cortesSeguidos = 0
        consulta?.cancelar()
        consulta = null
        // el primer aviso al conectar trae la cabeza de ahora: si hay algo que no se bajó (se perdió un aviso mientras
        // estaba cortado), este ciclo lo recupera. Si se esperaba un reintento por falta de conexión, el canal prueba que
        // ya hay: se adelanta
        if (cabeza > ultimoSeq() || estado == EstadoDeSincronizacion.SinConexion) pedirCiclo()
    }

    private fun alTerminarCanal(fin: FinDelCanal) {
        escucha = null
        generacion++
        when (fin) {
            FinDelCanal.DETENIDO -> Unit
            // en segundo plano también: hasta que venza el cierre puede volver a pantalla. Un 401 o 426 del canal lo
            // confirma el ciclo con el servidor (y entonces detiene todo); si no lo confirma, el canal se reintenta
            FinDelCanal.CORTADO, FinDelCanal.NO_DISPONIBLE, FinDelCanal.REVOCADO, FinDelCanal.APP_DESACTUALIZADA -> {
                if (fin == FinDelCanal.REVOCADO || fin == FinDelCanal.APP_DESACTUALIZADA) pedirCiclo()
                cortesSeguidos++
                reconexion = planificador.despues(Espera.tras(cortesSeguidos, azar)) {
                    reconexion = null
                    if (enPantalla && detenido == null) abrirCanal()
                }
                if (cortesSeguidos >= CORTES_ANTES_DE_CONSULTAR || fin != FinDelCanal.CORTADO) consultar()
            }
        }
    }

    /** Sin canal que funcione, un ciclo cada minuto hasta que el canal vuelva o se cierre. */
    private fun consultar() {
        if (consulta != null) return
        consulta = planificador.despues(CONSULTA_DE_RESPALDO_MS) {
            consulta = null
            pedirCiclo()
            consultar()
        }
    }

    private fun cerrarCanal() {
        generacion++
        escucha?.cancelar()
        escucha = null
        reconexion?.cancelar()
        reconexion = null
        consulta?.cancelar()
        consulta = null
        cortesSeguidos = 0
    }

    private fun detener(e: EstadoDeSincronizacion) {
        detenido = e
        cerrarCanal()
        // un reintento ya programado no corre: pedirCiclo mira `detenido`
        otraVez = false
        mostrar(e)
    }

    private fun mostrar(e: EstadoDeSincronizacion) {
        if (e == estado) return
        estado = e
        alCambiarEstado(e)
    }
}
