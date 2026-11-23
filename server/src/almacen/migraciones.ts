// Migraciones del esquema SQLite del servidor. Cada una se aplica una sola vez, en orden y dentro de su propia
// transacción; la versión aplicada queda en `schema_migration`. Nunca se edita una migración ya publicada: se agrega
// otra.

import type { Database } from "better-sqlite3";

export interface Migracion {
  readonly version: number;
  readonly sql: string;
}

const MIGRACIONES: readonly Migracion[] = [
  {
    version: 1,
    sql: `
      -- Entidades del viaje: una fila por entidad y, por cada campo escrito, su valor (JSON) con la marca que lo ganó.
      CREATE TABLE entity (
        trip_id TEXT NOT NULL,
        tipo    TEXT NOT NULL,
        id      TEXT NOT NULL,
        PRIMARY KEY (trip_id, tipo, id)
      ) WITHOUT ROWID;

      CREATE TABLE entity_field (
        trip_id TEXT NOT NULL,
        tipo    TEXT NOT NULL,
        id      TEXT NOT NULL,
        campo   TEXT NOT NULL,
        valor   TEXT NOT NULL,
        hlc     TEXT NOT NULL,
        PRIMARY KEY (trip_id, tipo, id, campo),
        FOREIGN KEY (trip_id, tipo, id) REFERENCES entity(trip_id, tipo, id) ON DELETE CASCADE
      ) WITHOUT ROWID;
      -- adjuntos de un dueño (adjuntosDe)
      CREATE INDEX ix_field_dueno ON entity_field(trip_id, valor) WHERE tipo = 'attachment' AND campo = 'owner_id';

      -- Lo que terminó (purgas y borrados definitivos) no vuelve a aparecer.
      CREATE TABLE entity_tombstone (
        trip_id TEXT NOT NULL,
        tipo    TEXT NOT NULL,
        id      TEXT NOT NULL,
        PRIMARY KEY (trip_id, tipo, id)
      ) WITHOUT ROWID;

      -- Registro ordenado de operaciones aceptadas (fuente de verdad).
      -- Los índices ix_op_entidad, ix_op_padre y ix_field_dueno los fuerzan con INDEXED BY las consultas de
      -- almacenSqlite.ts (CONSULTAS): no renombrarlos ni quitarlos sin cambiar esas consultas en la misma migración.
      CREATE TABLE op (
        trip_id     TEXT    NOT NULL,
        server_seq  INTEGER NOT NULL,
        op_id       TEXT    NOT NULL,
        entity_type TEXT    NOT NULL,
        entity_id   TEXT    NOT NULL,
        padre_id    TEXT,
        type        TEXT    NOT NULL,
        hlc         TEXT    NOT NULL,
        payload     TEXT,
        redactada   INTEGER NOT NULL DEFAULT 0 CHECK (redactada IN (0,1)),
        PRIMARY KEY (trip_id, server_seq),
        CHECK ((redactada = 1) = (payload IS NULL))
      ) WITHOUT ROWID;
      CREATE INDEX ix_op_entidad ON op(trip_id, entity_type, entity_id, server_seq);
      CREATE INDEX ix_op_padre ON op(trip_id, padre_id) WHERE padre_id IS NOT NULL;
      CREATE UNIQUE INDEX ux_op_hlc ON op(trip_id, hlc);
      CREATE UNIQUE INDEX ux_op_id ON op(trip_id, op_id);

      -- Períodos en que el viaje estuvo cerrado; se juzga cada operación por su hora de creación.
      CREATE TABLE trip_closed_interval (
        trip_id  TEXT    NOT NULL,
        desde_ms INTEGER NOT NULL,
        hasta_ms INTEGER,
        causa    TEXT    NOT NULL CHECK (causa IN ('MANUAL','FECHAS')),
        PRIMARY KEY (trip_id, desde_ms),
        CHECK (hasta_ms IS NULL OR hasta_ms > desde_ms)
      ) WITHOUT ROWID;
      -- a lo sumo un intervalo abierto por viaje (defensa de la base, además de la regla del código)
      CREATE UNIQUE INDEX ux_intervalo_abierto ON trip_closed_interval(trip_id) WHERE hasta_ms IS NULL;
    `,
  },
];

export const VERSION_ACTUAL = MIGRACIONES[MIGRACIONES.length - 1]?.version ?? 0;

/**
 * Aplica las migraciones pendientes y devuelve las versiones que aplicó. La versión ya aplicada se lee dentro de la
 * transacción inmediata de cada migración: si dos procesos arrancan a la vez, el segundo espera el bloqueo y al
 * entrar ya ve la migración hecha, en lugar de repetirla.
 */
export function migrar(db: Database, ahoraMs: number = Date.now(), migraciones: readonly Migracion[] = MIGRACIONES): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, aplicada_en INTEGER NOT NULL)");
  const ultima = migraciones[migraciones.length - 1]?.version ?? 0;
  const guardada = (db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migration").get() as { v: number }).v;
  if (guardada > ultima) throw new Error(`la base está en la versión ${guardada} de esquema y este servidor solo conoce hasta la ${ultima}: se necesita un servidor más nuevo`);
  const aplicadas: number[] = [];
  for (const m of migraciones) {
    const aplicada = db
      .transaction(() => {
        const hecha = (db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migration").get() as { v: number }).v;
        if (m.version <= hecha) return false;
        db.exec(m.sql);
        db.prepare("INSERT INTO schema_migration (version, aplicada_en) VALUES (?, ?)").run(m.version, ahoraMs);
        return true;
      })
      .immediate();
    if (aplicada) aplicadas.push(m.version);
  }
  return aplicadas;
}
