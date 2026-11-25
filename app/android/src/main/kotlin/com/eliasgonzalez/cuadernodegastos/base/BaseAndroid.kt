// La base local sobre el SQLite de Android: implementa el puerto de `datos`. Una transacción dentro de otra forma parte de
// ella (sin punto de guardado): solo la de afuera abre, confirma y cierra, porque el beginTransaction anidado de Android
// deshace toda la de afuera si una interna falla, aunque la de afuera la atrape. Las transacciones son por hilo.
// En las consultas los números viajan como texto (rawQuery): compararlos solo contra columnas con tipo o en LIMIT. Las
// transacciones van solo por `transaccion` (nunca BEGIN o COMMIT como texto) y los valores siempre como parámetros.
package com.eliasgonzalez.cuadernodegastos.base

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.eliasgonzalez.cuadernodegastos.datos.BaseSql
import com.eliasgonzalez.cuadernodegastos.datos.Fila

class BaseAndroid(private val db: SQLiteDatabase) : BaseSql {
    private fun argumentos(args: Array<out Any?>): Array<Any?> = args.map {
        when (it) {
            is Int -> it.toLong()
            is Boolean -> if (it) 1L else 0L
            else -> it
        }
    }.toTypedArray()

    override fun ejecutar(sql: String, vararg args: Any?): Int {
        require(';' !in sql.trimEnd().removeSuffix(";")) { "una sola sentencia por vez" }
        // un PRAGMA que fija algo (user_version) no se puede compilar como sentencia de cambio
        if (sql.trimStart().startsWith("PRAGMA", ignoreCase = true)) {
            db.execSQL(sql, argumentos(args))
            return 0
        }
        // todo lo demás por compileStatement: UPDATE y DELETE devuelven las filas cambiadas (escribirCampo lo usa), sin
        // depender de cómo empiece el texto; en lo demás el número no significa nada (SQLite repite el de la anterior)
        db.compileStatement(sql).use { st ->
            argumentos(args).forEachIndexed { i, a -> enlazar(st, i + 1, a) }
            return st.executeUpdateDelete().coerceAtLeast(0)
        }
    }

    private fun enlazar(st: android.database.sqlite.SQLiteStatement, i: Int, a: Any?) {
        when (a) {
            null -> st.bindNull(i)
            is Long -> st.bindLong(i, a)
            is String -> st.bindString(i, a)
            is Double -> st.bindDouble(i, a)
            else -> throw IllegalArgumentException("tipo no admitido: ${a::class.simpleName}")
        }
    }

    override fun consultar(sql: String, vararg args: Any?): List<Fila> {
        // rawQuery solo acepta textos como argumentos: los números se pasan como texto y SQLite los compara por afinidad
        val texto = argumentos(args).map { it?.toString() }.toTypedArray()
        require(texto.none { it == null }) { "un argumento null en una consulta: usar IS NULL en el SQL" }
        return db.rawQuery(sql, texto).use { c -> buildList { while (c.moveToNext()) add(fila(c)) } }
    }

    private fun fila(c: Cursor): Fila = (0 until c.columnCount).map { i ->
        when (c.getType(i)) {
            Cursor.FIELD_TYPE_NULL -> null
            Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
            Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
            else -> c.getString(i)
        }
    }

    override fun <T> transaccion(fn: () -> T): T {
        // inTransaction es por hilo: otro hilo con una transacción abierta no hace que esta se saltee
        if (db.inTransaction()) return fn()
        db.beginTransaction()
        try {
            val r = fn()
            db.setTransactionSuccessful()
            return r
        } finally {
            db.endTransaction()
        }
    }
}
