// Migraciones del esquema local. Cada una se aplica una sola vez, en orden, en su propia transacción; la versión queda en
// `PRAGMA user_version`. Nunca se edita una migración ya publicada en una versión de la app: se agrega otra.
package com.eliasgonzalez.cuadernodegastos.datos

object Migraciones {
    /** Cada migración es una lista de sentencias sueltas (Android ejecuta una por vez). */
    val TODAS: List<List<String>> = listOf(
        listOf(
            // Entidades del viaje: una fila por entidad y, por cada campo escrito, su valor (JSON) con la marca que lo ganó.
            """
            CREATE TABLE entity (
              trip_id TEXT NOT NULL,
              tipo TEXT NOT NULL,
              id TEXT NOT NULL,
              PRIMARY KEY (trip_id, tipo, id)
            ) WITHOUT ROWID
            """.trimIndent(),
            """
            CREATE TABLE entity_field (
              trip_id TEXT NOT NULL,
              tipo TEXT NOT NULL,
              id TEXT NOT NULL,
              campo TEXT NOT NULL,
              valor TEXT NOT NULL,
              hlc TEXT NOT NULL,
              PRIMARY KEY (trip_id, tipo, id, campo)
            ) WITHOUT ROWID
            """.trimIndent(),
            // adjuntos de un dueño
            "CREATE INDEX ix_field_dueno ON entity_field(trip_id, valor) WHERE tipo = 'attachment' AND campo = 'owner_id'",
            // Lo que terminó (purgas y borrados definitivos) no vuelve a aparecer.
            """
            CREATE TABLE entity_tombstone (
              trip_id TEXT NOT NULL,
              tipo TEXT NOT NULL,
              id TEXT NOT NULL,
              PRIMARY KEY (trip_id, tipo, id)
            ) WITHOUT ROWID
            """.trimIndent(),
            // Operaciones aplicadas en el celular, en el orden en que se aplicaron. La sincronización (cola de salida,
            // secuencia del servidor) agrega sus columnas en una migración propia.
            """
            CREATE TABLE op (
              local_id INTEGER PRIMARY KEY AUTOINCREMENT,
              trip_id TEXT NOT NULL,
              op_id TEXT NOT NULL,
              seq INTEGER NOT NULL CHECK (seq >= 1),
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              padre_id TEXT,
              type TEXT NOT NULL,
              hlc TEXT NOT NULL,
              payload TEXT,
              redactada INTEGER NOT NULL DEFAULT 0 CHECK (redactada IN (0,1)),
              schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
              CHECK ((redactada = 1) = (payload IS NULL))
            )
            """.trimIndent(),
            "CREATE UNIQUE INDEX ux_op_id ON op(trip_id, op_id)",
            // la posición de la operación en el viaje (1, 2, 3… sin huecos)
            "CREATE UNIQUE INDEX ux_op_seq ON op(trip_id, seq)",
            "CREATE UNIQUE INDEX ux_op_hlc ON op(trip_id, hlc)",
            "CREATE INDEX ix_op_entidad ON op(trip_id, entity_type, entity_id, local_id)",
            "CREATE INDEX ix_op_padre ON op(trip_id, padre_id) WHERE padre_id IS NOT NULL",
            // Períodos en que el viaje estuvo cerrado; a lo sumo uno abierto por viaje.
            """
            CREATE TABLE trip_closed_interval (
              trip_id TEXT NOT NULL,
              desde_ms INTEGER NOT NULL,
              hasta_ms INTEGER,
              causa TEXT NOT NULL CHECK (causa IN ('MANUAL','FECHAS')),
              PRIMARY KEY (trip_id, desde_ms),
              CHECK (hasta_ms IS NULL OR hasta_ms > desde_ms)
            ) WITHOUT ROWID
            """.trimIndent(),
            "CREATE UNIQUE INDEX ux_intervalo_abierto ON trip_closed_interval(trip_id) WHERE hasta_ms IS NULL",
        ),
    )

    /** La versión del esquema que entiende esta app. */
    val VERSION: Int get() = TODAS.size

    /** Una base con un esquema más nuevo que el de la app (por ejemplo, tras volver a una versión anterior). */
    class BaseMasNuevaError(version: Int) : IllegalStateException("la base tiene el esquema $version y esta app entiende hasta el $VERSION")

    /** Aplica las migraciones que falten; lee la versión dentro de la transacción. Devuelve la versión final. */
    fun aplicar(base: BaseSql): Int {
        while (true) {
            val aplicada = base.transaccion {
                val actual = (base.consultar("PRAGMA user_version").single()[0] as Long).toInt()
                if (actual > VERSION) throw BaseMasNuevaError(actual)
                if (actual == VERSION) return@transaccion null
                TODAS[actual].forEach { base.ejecutar(it) }
                base.ejecutar("PRAGMA user_version = ${actual + 1}")
                actual + 1
            } ?: return VERSION
            check(aplicada <= VERSION)
        }
    }
}
