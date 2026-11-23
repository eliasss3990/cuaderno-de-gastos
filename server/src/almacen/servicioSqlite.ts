// Armado del servicio de identidad sobre SQLite. El repositorio de identidad y los almacenes de los viajes se crean sobre
// la MISMA conexión: así la transacción que abre la identidad es la misma en la que escriben los viajes y crear un viaje
// es todo o nada. Armarlos por separado con conexiones distintas rompe esa garantía (el servicio no puede comprobarlo).

import type { Database } from "better-sqlite3";
import type { Aleatorio } from "../dominio/credenciales.js";
import { ServicioDeIdentidad } from "../dominio/servicioIdentidad.js";
import { AlmacenSqlite } from "./almacenSqlite.js";
import { IdentidadSqlite } from "./identidadSqlite.js";

export interface OpcionesDelServicio {
  /** Reloj del servidor, en milisegundos. */
  readonly ahora: () => number;
  readonly aleatorio?: Aleatorio;
}

export function servicioDeIdentidadSobre(db: Database, opciones: OpcionesDelServicio): ServicioDeIdentidad {
  const base = { identidad: new IdentidadSqlite(db), almacenDe: (tripId: string) => new AlmacenSqlite(db, tripId), ahora: opciones.ahora };
  return new ServicioDeIdentidad(opciones.aleatorio === undefined ? base : { ...base, aleatorio: opciones.aleatorio });
}
