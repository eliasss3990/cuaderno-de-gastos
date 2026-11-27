// Todo lo de sincronizar en la app, una instancia por proceso: los viajes vinculados, y por cada uno su ciclo (uno solo,
// lo comparten el coordinador y la tarea periódica) y su coordinador con el canal en vivo. Las llamadas públicas no
// bloquean: el trabajo pasa a un hilo propio (la base y el Keystore no se tocan desde el hilo principal).
package com.eliasgonzalez.cuadernodegastos.sincronizacion

import com.eliasgonzalez.cuadernodegastos.dominio.base.Reloj
import com.eliasgonzalez.cuadernodegastos.datos.AlmacenSqlite
import com.eliasgonzalez.cuadernodegastos.datos.BaseSql
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Ciclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Coordinador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.TiemposDelCoordinador
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.ViajeLocal
import com.eliasgonzalez.cuadernodegastos.red.CanalEnHilo
import com.eliasgonzalez.cuadernodegastos.red.CanalEnVivo
import com.eliasgonzalez.cuadernodegastos.red.ClienteHttp
import com.eliasgonzalez.cuadernodegastos.red.Credenciales
import com.eliasgonzalez.cuadernodegastos.red.EstadoDelCelular
import com.eliasgonzalez.cuadernodegastos.sesion.Tokens
import com.eliasgonzalez.cuadernodegastos.dominio.lecturas.LectorDelViaje
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.Executors

class Sincronizacion(
    private val base: BaseSql,
    private val tokens: Tokens,
    private val servidor: String,
    private val versionDeLaApp: String,
    /** Llega desde hilos de fondo (el de cada viaje, el de la tarea periódica): la pantalla lo pasa a su hilo. */
    private val alCambiarEstado: (viaje: String, EstadoDeSincronizacion) -> Unit = { _, _ -> },
    private val hora: () -> Long = System::currentTimeMillis,
    private val tiempos: TiemposDelCoordinador = TiemposDelCoordinador(),
) : AutoCloseable {
    /** Lo de un viaje: su almacén, su ciclo y su coordinador (con su planificador). */
    class DelViaje(val almacen: AlmacenSqlite, val sinc: Sincronizador, val ciclo: Ciclo, val coordinador: Coordinador, val planificador: PlanificadorDeHilos)

    private val _estados = MutableStateFlow<Map<String, EstadoDeSincronizacion>>(emptyMap())

    /** El último estado de cada viaje, para el indicador. */
    val estados: StateFlow<Map<String, EstadoDeSincronizacion>> = _estados

    private val _cambios = MutableStateFlow(0L)

    /** Sube cada vez que algo pudo cambiar lo que se ve (un ciclo, un registro): las pantallas vuelven a leer. */
    val cambios: StateFlow<Long> = _cambios

    private fun avisar(viaje: String, e: EstadoDeSincronizacion) {
        _estados.update { it + (viaje to e) }
        _cambios.update { it + 1 }
        alCambiarEstado(viaje, e)
    }

    private val hilo = Executors.newSingleThreadExecutor { r -> Thread(r, "sincronizacion").apply { isDaemon = true } }

    // solo se toca desde `hilo` (y desde cicloDe, que también se sincroniza con él)
    private val porViaje = mutableMapOf<String, DelViaje>()
    private var enPantalla = false

    /** Los viajes vinculados en este celular. */
    fun viajes(): List<String> = base.consultar("SELECT trip_id FROM trip_local ORDER BY trip_id").map { it[0] as String }

    /** Guarda las credenciales de un viaje nuevo (recién creado o recién unido). Bloquea: llamar fuera del hilo principal. */
    fun vincular(c: Credenciales) {
        val almacen = AlmacenSqlite(base, c.viaje)
        check(almacen.viajeLocal() == null) { "el viaje ya está vinculado en este celular" }
        // primero el token: un viaje sin token se ve como "hay que volver a vincular"
        tokens.guardar(c.viaje, c.token)
        almacen.guardarViajeLocal(ViajeLocal(c.dispositivo, c.integrante))
        // con la app en pantalla arranca ya; si no, cuando vuelva o con la tarea periódica
        en { if (enPantalla) delViaje(c.viaje)?.let { d -> d.planificador.despues(0) { d.coordinador.alPrimerPlano() } } }
    }

    /**
     * Arma (una vez) lo del viaje; null si ya quedó revocado o no tiene token legible (en los dos casos hay que volver a
     * vincular, y se avisa Revocado sin pedirle nada al servidor).
     */
    private fun delViaje(viaje: String): DelViaje? = synchronized(porViaje) {
        porViaje[viaje]?.let { return it }
        if (AlmacenSqlite(base, viaje).viajeLocal()?.revocado == true) {
            avisar(viaje, EstadoDeSincronizacion.Revocado)
            return null
        }
        val token = tokens.leer(viaje)
        if (token == null) {
            avisar(viaje, EstadoDeSincronizacion.Revocado)
            return null
        }
        val almacen = AlmacenSqlite(base, viaje)
        val sinc = Sincronizador(almacen, hora)
        val cliente = ClienteHttp(servidor, viaje, { token }, versionDeLaApp, {
            EstadoDelCelular(almacen.viajeLocal()?.ultimoSeq ?: 0, almacen.enEstado(EstadoOp.PENDIENTE).size)
        })
        val ciclo = Ciclo(sinc, almacen, cliente, hora)
        val planificador = PlanificadorDeHilos("sinc-${viaje.takeLast(4)}")
        val coordinador = Coordinador(
            ciclo = ciclo::correr,
            canal = CanalEnHilo { CanalEnVivo(servidor, viaje, { token }, versionDeLaApp) },
            planificador = planificador,
            ultimoSeq = { almacen.viajeLocal()?.ultimoSeq ?: 0 },
            alCambiarEstado = { avisar(viaje, it) },
            tiempos = tiempos,
        )
        DelViaje(almacen, sinc, ciclo, coordinador, planificador).also { porViaje[viaje] = it }
    }

    private fun en(accion: () -> Unit) {
        try {
            hilo.execute {
                try {
                    accion()
                } catch (_: Exception) {
                    // la base o el Keystore fallaron: lo próximo (otro aviso, la tarea periódica) vuelve a probar
                }
            }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            // ya cerrado
        }
    }

    private fun aCadaUno(accion: (DelViaje) -> Unit) = en {
        for (v in viajes()) delViaje(v)?.let { d -> d.planificador.despues(0) { accion(d) } }
    }

    /** La app pasó a primer plano. */
    fun alPrimerPlano() {
        en { enPantalla = true }
        aCadaUno { it.coordinador.alPrimerPlano() }
    }

    fun alSegundoPlano() {
        en { enPantalla = false }
        aCadaUno { it.coordinador.alSegundoPlano() }
    }

    /** Se guardó un cambio en el viaje: subirlo cuanto antes. */
    fun alCambioLocal(viaje: String) = en { delViaje(viaje)?.let { d -> d.planificador.despues(0) { d.coordinador.alCambioLocal() } } }

    /** Volvió la red (el sistema avisó que hay conexión): cada viaje intenta subir y bajar ya, sin esperar su reintento. */
    fun alVolverLaRed() = aCadaUno { it.coordinador.sincronizarAhora() }

    /** El celular se quedó sin ninguna red: el indicador de cada viaje pasa a "Sin conexión" en el acto. */
    fun alPerderLaRed() = aCadaUno { it.coordinador.alPerderLaRed() }

    fun sincronizarAhora(viaje: String) = en { delViaje(viaje)?.let { d -> d.planificador.despues(0) { d.coordinador.sincronizarAhora() } } }

    /** La hora corregida con el desfase aprendido del servidor (la de las marcas), o la del celular si no hay viaje. Bloquea. */
    fun ahora(viaje: String): Long =
        AlmacenSqlite(base, viaje).viajeLocal()?.let { Reloj.ahoraCorregida(System.currentTimeMillis(), it.desfaseMs) } ?: System.currentTimeMillis()

    /** Las credenciales guardadas de un viaje (para invitar), o null si no está vinculado, está revocado o el token no se lee. Bloquea. */
    fun credenciales(viaje: String): Credenciales? {
        val v = AlmacenSqlite(base, viaje).viajeLocal()?.takeIf { !it.revocado } ?: return null
        return Credenciales(viaje, v.dispositivo, v.integrante, tokens.leer(viaje) ?: return null)
    }

    /**
     * Registra una operación propia del viaje y avisa para subirla. Bloquea: llamar fuera del hilo principal. La marca
     * (que `op` pide con nuevaMarca) y el registro van en transacciones separadas: un ciclo puede correr en el medio, y
     * no pasa nada porque la marca queda reservada y se vuelve a validar al registrar. En un viaje revocado o sin token
     * lanza: la pantalla no deja cargar en ese caso. Desde cualquier hilo: `delViaje`
     * se sincroniza sobre `porViaje`.
     */
    fun registrar(viaje: String, op: (Sincronizador) -> Operacion): Resultado {
        val d = delViaje(viaje) ?: throw ViajeNoVinculado()
        val r = d.sinc.registrar(op(d.sinc))
        _cambios.update { it + 1 }
        alCambioLocal(viaje)
        return r
    }

    /** Lo que muestran las pantallas del viaje. Bloquea: fuera del hilo principal. */
    fun lector(viaje: String): LectorDelViaje = LectorDelViaje(AlmacenSqlite(base, viaje))

    /** Cuántas operaciones propias esperan subir (pendientes o enviándose). Bloquea. */
    fun pendientes(viaje: String): Int = AlmacenSqlite(base, viaje).let { it.enEstado(EstadoOp.PENDIENTE).size + it.enEstado(EstadoOp.ENVIANDO).size }

    /** Un resumen del viaje para revisar a mano (sin el token). Bloquea. */
    fun resumen(viaje: String): String {
        val a = AlmacenSqlite(base, viaje)
        val v = a.viajeLocal()
        val gastos = base.consultar("SELECT COUNT(*) FROM entity WHERE trip_id = ? AND tipo = 'expense'", viaje).single()[0]
        val porEstado = EstadoOp.entries.joinToString(" ") { e -> "${e.name.lowercase()}=${a.enEstado(e).size}" }
        return "viaje=$viaje seq=${v?.ultimoSeq} revocado=${v?.revocado} gastos=$gastos $porEstado"
    }

    /** Corre un ciclo del viaje en este hilo (bloquea) y dice cómo terminó; sin token o revocado, Revocado. */
    fun cicloDe(viaje: String): FinDelCiclo {
        val d = delViaje(viaje) ?: return FinDelCiclo.Revocado
        return try {
            d.ciclo.correr()
        } catch (_: Exception) {
            FinDelCiclo.Error
        }
    }

    /** Para la tarea periódica: un ciclo de cada viaje, en este hilo (bloquea). Devuelve cómo terminó cada uno. */
    fun cicloDeTodos(): Map<String, FinDelCiclo> = viajes().associateWith { v ->
        val d = delViaje(v) ?: return@associateWith FinDelCiclo.Revocado
        try {
            d.ciclo.correr()
        } catch (_: Exception) {
            FinDelCiclo.Error
        }
    }

    override fun close() {
        hilo.shutdownNow()
        synchronized(porViaje) { porViaje.values.forEach { it.planificador.close() } }
    }
}

/** El viaje está revocado o sin token: no se puede registrar nada hasta volver a vincularlo. */
class ViajeNoVinculado : IllegalStateException("el viaje está revocado o sin token: hay que volver a vincular")
