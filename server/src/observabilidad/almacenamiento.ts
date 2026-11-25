// Cuánto ocupa el servidor y cuánto disco queda: la base (con sus archivos -wal y -shm), los archivos de los adjuntos y el
// espacio libre de la carpeta de datos. Lo usan las métricas y la alerta de disco de la salud.

import { stat, statfs } from "node:fs/promises";
import type { ArchivosDeAdjuntos } from "../dominio/adjuntos/archivos.js";

/** Con menos de esto libre, la salud avisa `alerta`. */
export const ALERTA_DE_DISCO_BYTES = 1024 * 1024 * 1024;

export interface MedicionDeAlmacenamiento {
  readonly baseBytes: number;
  readonly adjuntosBytes: number;
  readonly libreBytes: number;
}

const tamano = async (archivo: string): Promise<number> => {
  try {
    return (await stat(archivo)).size;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
};

export async function medirAlmacenamiento(
  rutas: { readonly archivoBase: string; readonly dirDatos: string; readonly dirAdjuntos?: string },
  archivos: Pick<ArchivosDeAdjuntos, "listarViajes" | "bytesDelViaje">,
  /** Lo que mide el espacio libre de una carpeta; las pruebas simulan discos distintos. */
  leerDisco: (dir: string) => Promise<{ readonly bavail: number; readonly bsize: number }> = statfs,
): Promise<MedicionDeAlmacenamiento> {
  const base = await Promise.all(["", "-wal", "-shm"].map((sufijo) => tamano(rutas.archivoBase + sufijo)));
  const viajes = await archivos.listarViajes();
  const porViaje = await Promise.all(viajes.map((tripId) => archivos.bytesDelViaje(tripId)));
  // los adjuntos son lo que más crece: si están en otro disco, cuenta el que tenga menos lugar
  const discos = await Promise.all([rutas.dirDatos, ...(rutas.dirAdjuntos === undefined ? [] : [rutas.dirAdjuntos])].map((dir) => leerDisco(dir)));
  return {
    baseBytes: base.reduce((suma, bytes) => suma + bytes, 0),
    adjuntosBytes: porViaje.reduce((suma, bytes) => suma + bytes, 0),
    libreBytes: Math.min(...discos.map((d) => d.bavail * d.bsize)),
  };
}
