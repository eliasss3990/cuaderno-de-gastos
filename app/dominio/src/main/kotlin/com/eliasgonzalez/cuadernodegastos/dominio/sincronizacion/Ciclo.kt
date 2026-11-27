// Un ciclo de sincronización: subir lo pendiente (partiendo el lote si el servidor dice que es grande) y bajar hasta
// ponerse al día. Habla con el servidor por un puerto (en la app, HTTP); decide qué hacer ante cada error y cuándo
// reintentar. Una sola instancia por viaje mientras viva la app (guarda la cuenta de fallos seguidos) y un ciclo a la vez.
package com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.OpGuardada
import kotlin.math.min
import kotlin.random.Random

/** Por qué falló un pedido al servidor. */
enum class Falla {
    /** Tiempo agotado, 5xx, 429 o 503 (el servidor respondió que esperemos): se reintenta con espera. */
    TRANSITORIA,

    /**
     * Sin red (no se llegó al servidor): el ciclo reintenta con espera, pero las operaciones no guardan ninguna; al volver
     * la red, el próximo ciclo las sube enseguida (no quedan esperando minutos con la conexión ya andando).
     */
    SIN_RED,

    /** 413: el lote es demasiado grande y hay que partirlo. */
    DEMASIADO_GRANDE,

    /** 401: el dispositivo fue revocado o el token no sirve: se detiene y pide volver a vincular. */
    REVOCADO,

    /** 426: la app es demasiado vieja para el servidor. */
    APP_DESACTUALIZADA,

    /** 400, 403, 404, 415…: el servidor no acepta el pedido y reintentar no lo arregla; se avisa y se espera otro ciclo. */
    PEDIDO_RECHAZADO,
}

sealed interface RespuestaDeSubida {
    data class Ok(val resultados: List<RespuestaDeOp>, val horaDelServidor: Long?) : RespuestaDeSubida

    data class Error(val falla: Falla, val reintentarEnMs: Long? = null) : RespuestaDeSubida
}

data class Pagina(val ops: List<OpDelServidor>, val hayMas: Boolean, val horaDelServidor: Long?)

sealed interface RespuestaDeBajada {
    data class Ok(val pagina: Pagina) : RespuestaDeBajada

    data class Error(val falla: Falla, val reintentarEnMs: Long? = null) : RespuestaDeBajada
}

/** El servidor, visto desde el celular (en la app lo implementa el cliente HTTP). */
interface Servidor {
    fun subir(ops: List<OpGuardada>): RespuestaDeSubida

    fun bajar(despuesDe: Long, limite: Int): RespuestaDeBajada
}

/** Cómo terminó el ciclo, para el indicador de estado y para programar el próximo. */
sealed interface FinDelCiclo {
    /** Todo subido y bajado. */
    data object AlDia : FinDelCiclo

    /** Quedó algo por hacer: volver a intentar en `enMs`. */
    data class Reintentar(val enMs: Long) : FinDelCiclo

    data object Revocado : FinDelCiclo

    data object AppDesactualizada : FinDelCiclo

    /** El servidor rechazó el pedido entero (no una operación): se muestra como error y no se reintenta solo. */
    data object Error : FinDelCiclo
}

/** Espera creciente con aleatoriedad, de 1 s hasta 15 min. */
object Espera {
    const val MINIMA_MS = 1_000L
    const val MAXIMA_MS = 15 * 60_000L

    /** La espera tras `intentos` fallos seguidos (el primero espera alrededor de 1 s). */
    fun tras(intentos: Int, azar: Random = Random.Default): Long {
        val base = MINIMA_MS shl min(intentos.coerceAtLeast(1) - 1, 20)
        val tope = min(base, MAXIMA_MS)
        // entre la mitad y el total: dos celulares que fallaron juntos no vuelven a la vez
        return tope / 2 + azar.nextLong(tope / 2 + 1)
    }
}

class Ciclo(
    private val sinc: Sincronizador,
    private val cola: Cola,
    private val servidor: Servidor,
    private val horaDelCelular: () -> Long,
    private val azar: Random = Random.Default,
) {
    companion object {
        const val POR_PAGINA = 200
    }

    private var fallosSeguidos = 0

    /** Corre un ciclo. Dos llamadas a la vez (WorkManager, el canal en vivo, el botón) se ponen en fila. */
    @Synchronized
    fun correr(): FinDelCiclo {
        if (cola.viajeLocal()?.revocado == true) return FinDelCiclo.Revocado
        // lo que quedó en camino de un ciclo anterior (la app murió esperando la respuesta) vuelve a la cola; como pudo
        // haber llegado, cuenta como intento (no se puede descartar) y el servidor lo reconoce como duplicado
        val huerfanas = cola.enEstado(EstadoOp.ENVIANDO)
        if (huerfanas.isNotEmpty()) sinc.loteNoEnviado(huerfanas.map { it.op.opId }, null)
        subir()?.let { return it }
        bajar()?.let { return it }
        val pendiente = cola.enEstado(EstadoOp.PENDIENTE, 1).firstOrNull()
        // algo se cargó mientras tanto o espera un reintento: otro ciclo, ahora o cuando toque
        if (pendiente != null) return FinDelCiclo.Reintentar(((pendiente.proximoIntentoEn ?: 0) - horaDelCelular()).coerceAtLeast(0))
        // la cuenta de fallos seguidos vuelve a cero recién cuando no queda nada esperando
        fallosSeguidos = 0
        return FinDelCiclo.AlDia
    }

    private fun falla(f: Falla, reintentarEnMs: Long?): FinDelCiclo = when (f) {
        Falla.REVOCADO -> {
            cola.transaccion { cola.viajeLocal()?.let { cola.guardarViajeLocal(it.copy(revocado = true)) } }
            FinDelCiclo.Revocado
        }
        Falla.APP_DESACTUALIZADA -> FinDelCiclo.AppDesactualizada
        Falla.PEDIDO_RECHAZADO -> FinDelCiclo.Error
        else -> {
            fallosSeguidos++
            FinDelCiclo.Reintentar((reintentarEnMs ?: Espera.tras(fallosSeguidos, azar)).coerceAtLeast(0))
        }
    }

    /** Sube por lotes; ante un 413 parte el lote a la mitad (hasta una sola op). Devuelve el fin si hay que cortar. */
    private fun subir(): FinDelCiclo? {
        var tamano = Sincronizador.MAX_POR_LOTE
        while (true) {
            val lote = sinc.armarLote(tamano)
            if (lote.isEmpty()) return null
            when (val r = servidor.subir(lote)) {
                // el tamaño que entró se mantiene el resto del ciclo: no vuelve a probar con uno que ya fue grande
                is RespuestaDeSubida.Ok -> sinc.respuestaDelLote(r.resultados, r.horaDelServidor)
                is RespuestaDeSubida.Error -> {
                    if (r.falla == Falla.DEMASIADO_GRANDE) {
                        if (lote.size > 1) {
                            sinc.loteNoEnviado(lote.map { it.opId }, null)
                            tamano = lote.size / 2
                        } else {
                            // una sola op que el servidor no acepta por tamaño nunca va a pasar: a cuarentena
                            val op = lote.single()
                            sinc.respuestaDelLote(listOf(RespuestaDeOp(op.opId, false, null, op.hlc, "cuerpo_demasiado_grande")), null)
                        }
                        continue
                    }
                    val fin = falla(r.falla, r.reintentarEnMs)
                    // sin red, la espera es del ciclo (el coordinador), no de cada operación
                    val en = (fin as? FinDelCiclo.Reintentar)?.enMs?.takeIf { r.falla != Falla.SIN_RED }
                    sinc.loteNoEnviado(lote.map { it.opId }, en?.let { horaDelCelular() + it })
                    return fin
                }
            }
        }
    }

    /** Baja página por página mientras el servidor diga que hay más. */
    private fun bajar(): FinDelCiclo? {
        while (true) {
            val desde = cola.viajeLocal()?.ultimoSeq ?: 0
            when (val r = servidor.bajar(desde, POR_PAGINA)) {
                is RespuestaDeBajada.Ok -> {
                    sinc.aplicarBajada(r.pagina.ops, r.pagina.horaDelServidor)
                    if (!r.pagina.hayMas) return null
                    // "hay más" sin avanzar (página vacía o repetida) no puede repetirse sin fin: se reintenta después
                    if ((cola.viajeLocal()?.ultimoSeq ?: 0) <= desde) return falla(Falla.TRANSITORIA, null)
                }
                is RespuestaDeBajada.Error -> return falla(r.falla, r.reintentarEnMs)
            }
        }
    }
}
