// Carga en un viaje `ejemplo-` las operaciones de un archivo (el viaje de ejemplo): el servidor pone el id, la marca con
// su reloj y como autor el primer dispositivo activo. Formato: {"ops": [{"type", "entity_type", "entity_id", "payload"}]};
// `$viaje` como entity_id es el id del viaje, y lo demás que traiga cada operación (como `integrante`) se ignora.
// Las marcas son de ahora: si el viaje ya terminó por fechas, todo cae en el cierre. Las fechas pasadas van al final del
// archivo (un trip.update), y el viaje se crea sin fecha de fin.

import { readFileSync } from "node:fs";
import type { Database } from "better-sqlite3";
import { AlmacenSqlite } from "../almacen/operaciones/almacenSqlite.js";
import { formatearHlc, parsearHlc } from "../dominio/base/reloj.js";
import { uuidV7 } from "../dominio/identidad/credenciales.js";
import { ErrorDeServicio } from "../dominio/identidad/servicioIdentidad.js";
import { Ingesta } from "../dominio/operaciones/ingesta.js";
import type { Campos } from "../dominio/operaciones/operaciones.js";
import { VERSION_DE_FORMATO } from "../dominio/operaciones/validacion.js";
import { nombreDelViaje } from "./borrarViaje.js";

/** Tope de operaciones por archivo (un viaje de ejemplo tiene cientos, no decenas de miles). */
export const MAX_OPERACIONES_DEL_EJEMPLO = 5000;

/** En el archivo, el id del viaje (que no se conoce hasta crearlo). */
export const ID_DEL_VIAJE = "$viaje";

interface OpDelArchivo {
  readonly type: unknown;
  readonly entity_type: unknown;
  readonly entity_id: unknown;
  readonly payload: unknown;
}

function leerArchivo(archivo: string): readonly OpDelArchivo[] {
  let datos: unknown;
  try {
    datos = JSON.parse(readFileSync(archivo, "utf8"));
  } catch (e) {
    throw new ErrorDeServicio("formato_invalido", `no se puede leer el archivo (${archivo}): ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  const ops = (datos as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops) || ops.length === 0) throw new ErrorDeServicio("formato_invalido", "el archivo debe ser {\"ops\": [...]} con al menos una operación");
  if (ops.length > MAX_OPERACIONES_DEL_EJEMPLO) throw new ErrorDeServicio("formato_invalido", `el archivo tiene más de ${MAX_OPERACIONES_DEL_EJEMPLO} operaciones`);
  return ops as OpDelArchivo[];
}

/** Devuelve el resumen; si alguna se rechaza, sigue con las demás y lo informa (la carga no es todo o nada). */
export function cargarEjemplo(db: Database, tripId: string, archivo: string, ahora: () => number): { readonly lineas: string[]; readonly rechazadas: number } {
  const nombre = nombreDelViaje(db, tripId);
  if (nombre === null) throw new ErrorDeServicio("no_existe", "el viaje no existe");
  if (!nombre.startsWith("ejemplo-")) throw new ErrorDeServicio("formato_invalido", "solo se carga en un viaje de ejemplo (nombre que empiece con ejemplo-)");
  const ops = leerArchivo(archivo);
  const autor = db.prepare("SELECT device_id, member_id FROM device WHERE trip_id = ? AND revocado_en IS NULL ORDER BY creado_en, device_id LIMIT 1").get(tripId) as
    | { device_id: string; member_id: string }
    | undefined;
  if (autor === undefined) throw new ErrorDeServicio("no_existe", "el viaje no tiene dispositivos activos");
  const almacen = new AlmacenSqlite(db, tripId);
  const ingesta = new Ingesta(almacen, ahora);
  // después de la última marca del autor: dos operaciones del mismo viaje no pueden compartir marca
  const ultima = almacen.ultimaMarcaDe(autor.device_id);
  const previa = ultima === null ? null : parsearHlc(ultima);
  const ms = Math.max(ahora(), previa !== null && previa.ok ? previa.hlc.ms + 1 : 0);
  const lineas: string[] = [];
  let aceptadas = 0;
  let avisado = false;
  ops.forEach((elemento, i) => {
    // lo que no es un objeto se rechaza por formato como cualquier otra operación mal armada
    const o: OpDelArchivo = elemento !== null && typeof elemento === "object" ? elemento : { type: elemento, entity_type: undefined, entity_id: undefined, payload: undefined };
    const r = ingesta.procesar(
      {
        opId: uuidV7(ms),
        tipo: o.type as string,
        entidadTipo: o.entity_type as string,
        entidadId: (o.entity_id === ID_DEL_VIAJE ? tripId : o.entity_id) as string,
        hlc: formatearHlc({ ms, contador: i, dispositivo: autor.device_id }),
        payload: o.payload as Campos,
        schemaVersion: VERSION_DE_FORMATO,
      },
      { deviceId: autor.device_id, memberId: autor.member_id },
    );
    if (r.estado === "accepted") aceptadas += 1;
    else lineas.push(`operación ${i + 1} (${String(o.type)}): ${r.estado === "rejected" ? r.razon : r.estado}`);
    if (r.estado === "rejected" && r.razon === "viaje_cerrado" && !avisado) {
      avisado = true;
      lineas.push("el viaje ya terminó por fechas: crearlo sin fecha de fin y poner las fechas al final del archivo");
    }
  });
  return { lineas: [`cargadas ${aceptadas} de ${ops.length} operaciones en ${nombre}`, ...lineas], rechazadas: ops.length - aceptadas };
}
