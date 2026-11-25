// Todo lo de sincronizar en la app, una instancia por proceso: los viajes vinculados, y por cada uno su ciclo (uno solo,
// lo comparten el coordinador y la tarea periódica) y su coordinador con el canal en vivo. Las llamadas públicas no
// bloquean: el trabajo pasa a un hilo propio (la base y el Keystore no se tocan desde el hilo principal).
package com.eliasgonzalez.cuadernodegastos.sincronizacion

import com.eliasgonzalez.cuadernodegastos.datos.AlmacenSqlite
import com.eliasgonzalez.cuadernodegastos.datos.BaseSql
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Ciclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Coordinador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoDeSincronizacion
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.ViajeLocal
import com.eliasgonzalez.cuadernodegastos.red.CanalEnHilo
import com.eliasgonzalez.cuadernodegastos.red.CanalEnVivo
import com.eliasgonzalez.cuadernodegastos.red.ClienteHttp
import com.eliasgonzalez.cuadernodegastos.red.Credenciales
import com.eliasgonzalez.cuadernodegastos.red.EstadoDelCelular
import com.eliasgonzalez.cuadernodegastos.sesion.Tokens
import java.util.concurrent.Executors

class Sincronizacion(
    private val base: BaseSql,
    private val tokens: Tokens,
    private val servidor: String,
    private val versionDeLaApp: String,
    /** Llega desde hilos de fondo (el de cada viaje, el de la tarea periódica): la pantalla lo pasa a su hilo. */
    private val alCambiarEstado: (viaje: String, EstadoDeSincronizacion) -> Unit = { _, _ -> },
    private val hora: () -> Long = System::currentTimeMillis,
) : AutoCloseable {
    /** Lo de un viaje: su almacén, su ciclo y su coordinador (con su planificador). */
    class DelViaje(val almacen: AlmacenSqlite, val sinc: Sincronizador, val ciclo: Ciclo, val coordinador: Coordinador, val planificador: PlanificadorDeHilos)

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

    /** Arma (una vez) lo del viaje; null si no tiene token legible (hay que volver a vincular). Corre en `hilo`. */
    private fun delViaje(viaje: String): DelViaje? = synchronized(porViaje) {
        porViaje[viaje]?.let { return it }
        val token = tokens.leer(viaje)
        if (token == null) {
            alCambiarEstado(viaje, EstadoDeSincronizacion.Revocado)
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
            alCambiarEstado = { alCambiarEstado(viaje, it) },
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

    fun sincronizarAhora(viaje: String) = en { delViaje(viaje)?.let { d -> d.planificador.despues(0) { d.coordinador.sincronizarAhora() } } }

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
