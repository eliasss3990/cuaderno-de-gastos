// Los archivos de los adjuntos: el puerto donde se guardan, el formato estricto de los identificadores con los que se arma su
// ruta y la detección del tipo por los primeros bytes (nunca por el nombre ni por lo que declare el cliente).

import type { Readable } from "node:stream";

/** Un adjunto tiene su archivo y, si es una imagen, también una miniatura. */
export type Variante = "archivo" | "miniatura";

export type Mime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** Qué archivo es: el viaje, el adjunto y la variante, con la extensión que fija el servidor. */
export interface RefDeArchivo {
  readonly tripId: string;
  readonly adjuntoId: string;
  readonly variante: Variante;
  readonly extension: string;
}

export interface ArchivoAbierto {
  readonly flujo: Readable;
  readonly bytes: number;
}

export interface ArchivosDeAdjuntos {
  existe(ref: RefDeArchivo): Promise<boolean>;
  /** Guarda el archivo completo o no guarda nada: nadie puede leer uno a medias. */
  guardar(ref: RefDeArchivo, bytes: Uint8Array): Promise<void>;
  /** Cuántos bytes ocupan los archivos de un viaje (los que ya están completos). */
  bytesDelViaje(tripId: string): Promise<number>;
  /** Abre el archivo para leerlo, o devuelve null si no se subió. */
  abrir(ref: RefDeArchivo): Promise<ArchivoAbierto | null>;
}

/** Los identificadores con los que se arma una ruta: UUID en minúsculas y nada más. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const EXTENSION_DE: Readonly<Record<Mime, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const empieza = (bytes: Uint8Array, desde: number, firma: readonly number[]): boolean => firma.every((b, i) => bytes[desde + i] === b);

/** El tipo según los primeros bytes (lista blanca: JPEG, PNG, WebP y PDF), o null si no es ninguno. */
export function detectarTipo(bytes: Uint8Array): Mime | null {
  if (empieza(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empieza(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: "RIFF", cuatro bytes de tamaño y "WEBP"
  if (empieza(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && empieza(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  if (empieza(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}
