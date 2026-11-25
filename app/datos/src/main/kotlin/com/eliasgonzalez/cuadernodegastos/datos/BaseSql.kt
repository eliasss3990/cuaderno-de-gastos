// Puerto mínimo hacia SQLite. La app lo implementa con el SQLite de Android y las pruebas con sqlite-jdbc.
// El SQL de este módulo debe funcionar en SQLite 3.18 (Android 8, la versión mínima): sin UPSERT, sin columnas
// generadas, sin tablas STRICT, sin RETURNING ni funciones JSON.
package com.eliasgonzalez.cuadernodegastos.datos

/** Un valor de una fila: Long, String o null (la base no guarda otros tipos). */
typealias Fila = List<Any?>

interface BaseSql {
    /** Ejecuta UNA sentencia con parámetros (`?`) y devuelve las filas cambiadas (Android no admite varias juntas). */
    fun ejecutar(sql: String, vararg args: Any?): Int

    /** Las filas de una consulta con parámetros, en orden, cada una como lista de columnas. */
    fun consultar(sql: String, vararg args: Any?): List<Fila>

    /**
     * Ejecuta `fn` en una transacción: si lanza, se deshace todo. Una transacción dentro de otra forma parte de ella
     * (sin punto de guardado): si la interna lanza y la externa lo captura, lo escrito por la interna queda.
     * En Android no alcanza con anidar `beginTransaction` (la interna fallida deshace toda la externa): el adaptador
     * lleva la profundidad y solo la externa abre, confirma y cierra.
     */
    fun <T> transaccion(fn: () -> T): T
}
