// Apertura de la base SQLite del servidor: modo WAL, claves foráneas, espera ante un bloqueo y migraciones.

import Database, { type Database as Base } from "better-sqlite3";
import { migrar } from "./migraciones.js";

export interface OpcionesBase {
  /** Milisegundos que espera una escritura si otra conexión tiene el bloqueo (por defecto 5000). */
  readonly esperaMs?: number;
}

export function abrirBase(ruta: string, opciones: OpcionesBase = {}): Base {
  const db = new Database(ruta);
  try {
    db.pragma(`busy_timeout = ${Math.trunc(opciones.esperaMs ?? 5000)}`);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // FULL: una operación ya confirmada al cliente no se pierde ante un corte de energía (con NORMAL podría perderse)
    db.pragma("synchronous = FULL");
    migrar(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
