package com.eliasgonzalez.cuadernodegastos.datos

import java.sql.Connection
import java.sql.DriverManager

/** `BaseSql` sobre sqlite-jdbc, para probar el SQL contra una SQLite real en la JVM. */
class BaseJdbc(url: String = "jdbc:sqlite::memory:") : BaseSql, AutoCloseable {
    val conexion: Connection = DriverManager.getConnection(url)
    private var profundidad = 0

    private fun preparar(sql: String, args: Array<out Any?>) = conexion.prepareStatement(sql).also { st ->
        args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
    }

    // como en Android, una sola sentencia por vez (sqlite-jdbc ejecutaría todas y escondería el problema)
    override fun ejecutar(sql: String, vararg args: Any?): Int {
        require(';' !in sql.trimEnd().removeSuffix(";")) { "una sola sentencia por vez: $sql" }
        // execute y no executeUpdate: algunas sentencias (ALTER TABLE en sqlite-jdbc) informan que devuelven filas
        return preparar(sql, args).use { st -> st.execute(); maxOf(st.updateCount, 0) }
    }

    override fun consultar(sql: String, vararg args: Any?): List<Fila> = preparar(sql, args).use { st ->
        st.executeQuery().use { rs ->
            val n = rs.metaData.columnCount
            buildList {
                while (rs.next()) {
                    add(
                        (1..n).map { c ->
                            when (val v = rs.getObject(c)) {
                                is Int -> v.toLong()
                                else -> v
                            }
                        },
                    )
                }
            }
        }
    }

    override fun <T> transaccion(fn: () -> T): T {
        if (profundidad > 0) return fn() // forma parte de la de afuera
        conexion.autoCommit = false
        profundidad++
        try {
            return fn().also { conexion.commit() }
        } catch (e: Throwable) {
            try {
                conexion.rollback()
            } catch (r: Exception) {
                e.addSuppressed(r)
            }
            throw e
        } finally {
            profundidad--
            conexion.autoCommit = true
        }
    }

    override fun close() = conexion.close()
}
