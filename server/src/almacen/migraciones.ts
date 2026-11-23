// Migraciones del esquema SQLite del servidor. Cada una se aplica una sola vez, en orden y dentro de su propia
// transacción; la versión aplicada queda en `schema_migration`. Nunca se edita una migración ya publicada: se agrega
// otra.

import type { Database } from "better-sqlite3";

export interface Migracion {
  readonly version: number;
  readonly sql: string;
}

export const MIGRACIONES: readonly Migracion[] = [
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
  {
    version: 2,
    sql: `
      -- Dispositivo que generó la marca: es su tercer componente (13 de milisegundos, guion, 4 del contador, guion).
      -- Sirve para hallar la última marca de un dispositivo sin recorrer el registro.
      ALTER TABLE op ADD COLUMN dispositivo TEXT GENERATED ALWAYS AS (substr(hlc, 20)) VIRTUAL;
      CREATE INDEX ix_op_dispositivo ON op(trip_id, dispositivo, hlc);
    `,
  },
  {
    version: 3,
    sql: `
      -- Dispositivos autorizados de un viaje. El token nunca se guarda: solo su huella (SHA-256 en 64 hexadecimales
      -- en minúscula; un token en claro no cumple la forma). length() y GLOB se detienen en un NUL, por eso también
      -- se comprueba el largo en bytes. El integrante es una entidad más del viaje (la crea
      -- member.join), por eso member_id no es una clave foránea. Las tablas son STRICT: un texto o un decimal en una
      -- columna entera falla en vez de romper las comparaciones en silencio.
      CREATE TABLE device (
        device_id         TEXT    PRIMARY KEY,
        trip_id           TEXT    NOT NULL,
        member_id         TEXT    NOT NULL,
        nombre            TEXT    NOT NULL,
        token_hash        TEXT    NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND length(CAST(token_hash AS BLOB)) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
        creado_en         INTEGER NOT NULL,
        revocado_en       INTEGER,
        ultimo_visto_en   INTEGER,
        ultimo_seq_visto  INTEGER NOT NULL DEFAULT 0 CHECK (ultimo_seq_visto >= 0),
        pendientes        INTEGER NOT NULL DEFAULT 0 CHECK (pendientes >= 0),
        CHECK (revocado_en IS NULL OR revocado_en >= creado_en)
      ) STRICT;
      CREATE INDEX ix_device_trip ON device(trip_id, revocado_en);
      -- un integrante tiene un solo dispositivo activo: reemplazar un celular revoca al viejo (el viejo ya no cuenta)
      CREATE UNIQUE INDEX ux_device_miembro_activo ON device(trip_id, member_id) WHERE revocado_en IS NULL;

      -- Invitaciones de un solo uso; el código nunca se guarda: solo su huella.
      CREATE TABLE invitation (
        invitation_id        TEXT    PRIMARY KEY,
        trip_id              TEXT    NOT NULL,
        codigo_hash          TEXT    NOT NULL UNIQUE CHECK (length(codigo_hash) = 64 AND length(CAST(codigo_hash AS BLOB)) = 64 AND codigo_hash NOT GLOB '*[^0-9a-f]*'),
        reemplaza_member_id  TEXT,
        creada_en            INTEGER NOT NULL,
        vence_en             INTEGER NOT NULL,
        usada_en             INTEGER,
        usada_por_device_id  TEXT,
        CHECK (vence_en > creada_en),
        CHECK (usada_en IS NULL OR usada_en >= creada_en),
        CHECK ((usada_en IS NULL) = (usada_por_device_id IS NULL))
      ) STRICT;

      -- un dispositivo consume a lo sumo una invitación (en un índice único los NULL son distintos: las sin usar conviven)
      CREATE UNIQUE INDEX ux_invitation_dispositivo ON invitation(usada_por_device_id);

      -- Intentos de unirse por huella de la IP, para limitar la frecuencia.
      CREATE TABLE join_attempt (
        ip_hash       TEXT    NOT NULL CHECK (length(ip_hash) = 64 AND length(CAST(ip_hash AS BLOB)) = 64 AND ip_hash NOT GLOB '*[^0-9a-f]*'),
        intentado_en  INTEGER NOT NULL,
        ok            INTEGER NOT NULL CHECK (ok IN (0,1))
      ) STRICT;
      CREATE INDEX ix_join_attempt ON join_attempt(ip_hash, intentado_en);
      -- limpiar lo viejo no recorre la tabla (un ataque la hace crecer entre limpiezas)
      CREATE INDEX ix_join_attempt_hora ON join_attempt(intentado_en);
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
