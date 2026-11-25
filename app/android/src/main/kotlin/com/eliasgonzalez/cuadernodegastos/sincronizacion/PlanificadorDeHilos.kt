// El planificador del coordinador en la app: un hilo propio para el coordinador (todo su estado vive ahí) y otro para
// los ciclos, que bloquean con la red y la base. Nunca el hilo principal.
package com.eliasgonzalez.cuadernodegastos.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Cancelable
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Planificador
import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class PlanificadorDeHilos(private val nombre: String) : Planificador, AutoCloseable {
    private fun hilos(sufijo: String) = { r: Runnable -> Thread(r, "$nombre-$sufijo").apply { isDaemon = true } }

    private val coordinador: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor(hilos("coordinador"))
    private val trabajos: ExecutorService = Executors.newSingleThreadExecutor(hilos("ciclo"))

    override fun despues(ms: Long, accion: () -> Unit): Cancelable {
        val f = try {
            coordinador.schedule({ accion() }, ms.coerceAtLeast(0), TimeUnit.MILLISECONDS)
        } catch (_: RejectedExecutionException) {
            return Cancelable { } // ya cerrado: un aviso tardío (el canal que termina) no tiene a quién llegar
        }
        return Cancelable { f.cancel(false) }
    }

    override fun <T> aparte(trabajo: () -> T, luego: (T) -> Unit) {
        // el coordinador ya atrapa las fallas del ciclo; si igual algo lanzara acá, se perdería el aviso
        try {
            trabajos.execute {
                val r = trabajo()
                despues(0) { luego(r) }
            }
        } catch (_: RejectedExecutionException) {
            // ya cerrado
        }
    }

    override fun close() {
        coordinador.shutdownNow()
        trabajos.shutdownNow()
    }
}
