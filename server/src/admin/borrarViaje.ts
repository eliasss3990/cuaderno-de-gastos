// Borrado completo de un viaje de prueba (`humo-` o `ejemplo-`): sus filas en una transacción y después sus archivos.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { AlmacenSqlite } from "../almacen/operaciones/almacenSqlite.js";
import { ErrorDeServicio } from "../dominio/identidad/servicioIdentidad.js";

/** Solo se borran viajes cuyo nombre empiece así: un viaje real no se puede borrar por error. */
export const PREFIJOS_BORRABLES = ["humo-", "ejemplo-"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Tablas con datos de un viaje (las de entidades primero: los campos caen en cascada). */
const TABLAS = ["entity_field", "entity", "entity_tombstone", "op", "trip_closed_interval", "invitation", "device"] as const;

export function nombreDelViaje(db: Database, tripId: string): string | null {
  const nombre = new AlmacenSqlite(db, tripId).leerCampo("trip", tripId, "nombre");
  return typeof nombre === "string" ? nombre : null;
}

/** Borra el viaje y devuelve cuántas filas quitó. `no_existe` si no existe; `formato_invalido` si no es de prueba. */
export async function borrarViaje(db: Database, tripId: string, dirAdjuntos: string): Promise<number> {
  // el id termina siendo parte de una ruta: solo con forma de UUID
  const nombre = UUID.test(tripId) ? nombreDelViaje(db, tripId) : null;
  if (nombre === null) throw new ErrorDeServicio("no_existe", "el viaje no existe");
  if (!PREFIJOS_BORRABLES.some((p) => nombre.startsWith(p))) {
    throw new ErrorDeServicio("formato_invalido", `solo se borran viajes de prueba (nombre que empiece con ${PREFIJOS_BORRABLES.join(" o ")})`);
  }
  const filas = db.transaction(() => TABLAS.reduce((total, tabla) => total + db.prepare(`DELETE FROM ${tabla} WHERE trip_id = ?`).run(tripId).changes, 0)).immediate();
  // los archivos se borran después de confirmar: un archivo no se deshace con un rollback
  await rm(join(dirAdjuntos, tripId), { recursive: true, force: true });
  return filas;
}
