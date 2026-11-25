// Apertura de la base SQLite del servidor: modo WAL, claves foráneas, espera ante un bloqueo y migraciones.

import Database, { type Database as Base } from "better-sqlite3";
import { migrar, VERSION_ACTUAL } from "./migraciones.js";

export interface OpcionesBase {
  /** Milisegundos que espera una escritura si otra conexión tiene el bloqueo (por defecto 5000). */
  readonly esperaMs?: number;
  /** Falla si el archivo no existe, en vez de crear una base vacía (la administración nunca crea una). */
  readonly soloExistente?: boolean;
  /** Sin migrar: exige que la base ya esté exactamente en la versión de este código (la administración no cambia el esquema). */
  readonly sinMigrar?: boolean;
}

export function abrirBase(ruta: string, opciones: OpcionesBase = {}): Base {
  const db = new Database(ruta, { fileMustExist: opciones.soloExistente === true });
  try {
    db.pragma(`busy_timeout = ${Math.trunc(opciones.esperaMs ?? 5000)}`);
    // sin migrar se comprueba la versión antes de cualquier ajuste que escriba en el archivo
    if (opciones.sinMigrar === true) {
      const fila = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migration").get() as { v: number } | undefined;
      if (fila?.v !== VERSION_ACTUAL) throw new Error(`la base está en la versión ${fila?.v ?? 0} de esquema y este código espera la ${VERSION_ACTUAL}`);
    }
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // FULL: una operación ya confirmada al cliente no se pierde ante un corte de energía (con NORMAL podría perderse)
    db.pragma("synchronous = FULL");
    if (opciones.sinMigrar !== true) migrar(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
