// La tarea periódica del sistema (WorkManager): un ciclo de cada viaje. Usa los mismos ciclos que la app abierta, así
// que si coinciden se ponen en fila en vez de pisarse.
package com.eliasgonzalez.cuadernodegastos.sincronizacion

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.eliasgonzalez.cuadernodegastos.CuadernoApp

class TrabajoPeriodico(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        // cada viaje termina como termina (al día, a reintentar, revocado…): la próxima vuelta lo retoma; los reintentos
        // con espera los hace el coordinador mientras la app está abierta, acá solo se espera a la próxima tarea
        (applicationContext as CuadernoApp).sincronizacion.cicloDeTodos()
        return Result.success()
    }
}
