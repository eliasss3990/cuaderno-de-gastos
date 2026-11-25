// La aplicación: arma la sincronización una sola vez, la avisa cuando la app pasa a primer o segundo plano y deja
// programada la tarea periódica (con la app cerrada, como máximo cada 15 min y solo con red).
package com.eliasgonzalez.cuadernodegastos

import android.app.Application
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.eliasgonzalez.cuadernodegastos.base.BaseAndroid
import com.eliasgonzalez.cuadernodegastos.datos.Migraciones
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.TiemposDelCoordinador
import com.eliasgonzalez.cuadernodegastos.sesion.CifradorKeystore
import com.eliasgonzalez.cuadernodegastos.sesion.Tokens
import com.eliasgonzalez.cuadernodegastos.sincronizacion.Sincronizacion
import com.eliasgonzalez.cuadernodegastos.sincronizacion.TrabajoPeriodico
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CuadernoApp : Application() {
    companion object {
        const val TAREA_PERIODICA = "sincronizacion-periodica"
        const val BASE = "cuaderno.db"
    }

    /** Se arma en el primer uso (abre la base: nunca desde el hilo principal). */
    val sincronizacion: Sincronizacion by lazy {
        val db = SQLiteDatabase.openOrCreateDatabase(getDatabasePath(BASE).apply { parentFile?.mkdirs() }, null)
        val base = BaseAndroid(db).also { Migraciones.aplicar(it) }
        Sincronizacion(
            base,
            Tokens(getSharedPreferences(Tokens.ARCHIVO, Context.MODE_PRIVATE), CifradorKeystore()),
            BuildConfig.SERVIDOR,
            versionParaElServidor(BuildConfig.VERSION_NAME),
            alCambiarEstado = { viaje, e -> if (BuildConfig.DEBUG) Log.i("CuadernoDev", "estado ${viaje.takeLast(4)}: $e") },
            tiempos = TiemposDelCoordinador(BuildConfig.CIERRE_EN_SEGUNDO_PLANO_MS, BuildConfig.CONSULTA_DE_RESPALDO_MS),
        )
    }

    override fun onCreate() {
        super.onCreate()
        ProcessLifecycleOwner.get().lifecycle.addObserver(EventosDeLaApp({ sincronizacion.alPrimerPlano() }, { sincronizacion.alSegundoPlano() }))
        programarTareaPeriodica(this)
    }
}

/**
 * Pasa los cambios de primer y segundo plano a la sincronización fuera del hilo principal (el primer uso arma la base)
 * y en el mismo orden en que ocurrieron: abrir y cerrar rápido no puede dejar el canal abierto con la app cerrada.
 */
class EventosDeLaApp(private val alPrimerPlano: () -> Unit, private val alSegundoPlano: () -> Unit) : DefaultLifecycleObserver {
    private val hilo = Executors.newSingleThreadExecutor { r -> Thread(r, "eventos-de-la-app").apply { isDaemon = true } }

    override fun onStart(owner: LifecycleOwner) = hilo.execute(alPrimerPlano)

    override fun onStop(owner: LifecycleOwner) = hilo.execute(alSegundoPlano)
}

/** La versión que se le informa al servidor: sin el sufijo de desarrollo ("0.1.1-debug" → "0.1.1"), porque compara números. */
fun versionParaElServidor(nombre: String) = nombre.substringBefore('-')

/** Una sola tarea con nombre: si ya está programada, se deja como está. */
fun programarTareaPeriodica(context: Context) {
    val pedido = PeriodicWorkRequestBuilder<TrabajoPeriodico>(15, TimeUnit.MINUTES)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(CuadernoApp.TAREA_PERIODICA, ExistingPeriodicWorkPolicy.KEEP, pedido)
}
