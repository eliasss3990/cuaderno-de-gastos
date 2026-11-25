// Solo en la app de desarrollo: `adb shell am broadcast -a com.eliasgonzalez.cuadernodegastos.SINCRONIZAR_YA` corre la
// tarea periódica una vez, ya (el sistema no deja bajar de 15 min el intervalo). Solo adb puede mandarlo (permiso DUMP).
package com.eliasgonzalez.cuadernodegastos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.eliasgonzalez.cuadernodegastos.sincronizacion.TrabajoPeriodico

class SincronizarYa : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<TrabajoPeriodico>().build())
    }
}
