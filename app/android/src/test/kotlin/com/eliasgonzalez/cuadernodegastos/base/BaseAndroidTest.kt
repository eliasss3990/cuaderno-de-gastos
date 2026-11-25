package com.eliasgonzalez.cuadernodegastos.base

import android.database.sqlite.SQLiteDatabase
import com.eliasgonzalez.cuadernodegastos.datos.AlmacenSqlite
import com.eliasgonzalez.cuadernodegastos.datos.Migraciones
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Almacen
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenObservable
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ContratoAlmacen
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ContratoCola
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Cola
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode

private fun nueva(): AlmacenSqlite {
    val base = BaseAndroid(SQLiteDatabase.create(null))
    Migraciones.aplicar(base)
    return AlmacenSqlite(base, "viaje-1")
}

// Robolectric con la API 34: la 36 pide Java 21 y el proyecto compila con 17. El SQLite nativo es el de Android.

/** El almacén sobre el SQLite de Android cumple el mismo contrato que el de memoria y el de sqlite-jdbc. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class BaseAndroidContratoTest : ContratoAlmacen() {
    override fun crear(): AlmacenObservable {
        val a = nueva()
        return object : AlmacenObservable, Almacen by a {
            override fun instantanea() = a.instantanea()
            override fun secuencias() = a.secuencias()
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class BaseAndroidColaTest : ContratoCola() {
    override fun crear(): Cola = nueva()
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class BaseAndroidTest {
    @Test
    fun lasMigracionesCorrenSobreElSqliteDeAndroidYNoSeRepiten() {
        val db = SQLiteDatabase.create(null)
        val base = BaseAndroid(db)
        assertEquals(Migraciones.VERSION, Migraciones.aplicar(base))
        assertEquals(Migraciones.VERSION, Migraciones.aplicar(base))
        assertEquals(Migraciones.VERSION.toLong(), base.consultar("PRAGMA user_version").single()[0])
    }

    @Test
    fun unaSolaSentenciaPorVezYUpdateDevuelveLasFilasCambiadas() {
        val base = BaseAndroid(SQLiteDatabase.create(null))
        base.ejecutar("CREATE TABLE t (a INTEGER, b TEXT)")
        assertThrows(IllegalArgumentException::class.java) { base.ejecutar("INSERT INTO t VALUES (1, 'x'); INSERT INTO t VALUES (2, 'y')") }
        base.ejecutar("INSERT INTO t VALUES (?, ?)", 1L, "x")
        base.ejecutar("INSERT INTO t VALUES (?, ?)", 2, null)
        assertEquals(1, base.ejecutar("UPDATE t SET b = ? WHERE a = ?", "z", 1L))
        assertEquals(0, base.ejecutar("UPDATE t SET b = ? WHERE a = ?", "z", 9L))
        assertEquals(1, base.ejecutar("UPDATE t SET b = ? WHERE a = ?", "w", 2)) // un Int también se enlaza
        assertEquals(listOf(listOf<Any?>(1L, "z"), listOf<Any?>(2L, "w")), base.consultar("SELECT a, b FROM t ORDER BY a"))
        assertEquals(listOf(listOf<Any?>(2L)), base.consultar("SELECT a FROM t WHERE a > ? LIMIT ?", 1L, 5L))
        // las filas cambiadas no dependen de cómo empiece el texto
        assertEquals(2, base.ejecutar("  update\n t\tSET b = ?", "q"))
        assertEquals(1, base.ejecutar("WITH x AS (SELECT 1) DELETE FROM t WHERE a = ?", 1L))
    }

    @Test
    fun unaTransaccionDeOtroHiloNoHaceQueLaPropiaSeSaltee() {
        val db = SQLiteDatabase.create(null)
        val base = BaseAndroid(db)
        base.ejecutar("CREATE TABLE t (a INTEGER)")
        val abierta = java.util.concurrent.CountDownLatch(1)
        val seguir = java.util.concurrent.CountDownLatch(1)
        val otro = Thread {
            base.transaccion {
                base.ejecutar("INSERT INTO t VALUES (1)")
                abierta.countDown()
                seguir.await()
            }
        }
        otro.start()
        abierta.await()
        // mientras el otro hilo tiene su transacción abierta, esta igual se deshace si falla
        val aca = Thread {
            try {
                base.transaccion {
                    base.ejecutar("INSERT INTO t VALUES (2)")
                    error("falla")
                }
            } catch (_: IllegalStateException) {
            }
        }
        aca.start()
        Thread.sleep(200) // margen para que este hilo llegue a esperar; si no llega, la prueba no da un falso fallo
        seguir.countDown()
        otro.join()
        aca.join()
        assertEquals(listOf(listOf<Any?>(1L)), base.consultar("SELECT a FROM t"))
    }

    @Test
    fun unaTransaccionInternaQueFallaYSeAtrapaNoDeshaceLaExterna() {
        val base = BaseAndroid(SQLiteDatabase.create(null))
        base.ejecutar("CREATE TABLE t (a INTEGER)")
        base.transaccion {
            try {
                base.transaccion {
                    base.ejecutar("INSERT INTO t VALUES (1)")
                    error("falla interna")
                }
            } catch (_: IllegalStateException) {
            }
            base.ejecutar("INSERT INTO t VALUES (2)")
        }
        assertEquals(2, base.consultar("SELECT a FROM t").size)
        // y una externa que falla deshace todo
        try {
            base.transaccion {
                base.ejecutar("INSERT INTO t VALUES (3)")
                error("falla")
            }
        } catch (_: IllegalStateException) {
        }
        assertEquals(2, base.consultar("SELECT a FROM t").size)
    }
}
