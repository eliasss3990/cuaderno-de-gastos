// Lo que el servidor y la administración leen igual del disco: el nombre de la base y el archivo del pepper.
// Módulo chico a propósito: la administración lo importa sin cargar la API.

import { readFileSync } from "node:fs";
import { ErrorDeConfiguracion } from "./configuracion.js";
import { leerPepper } from "./dominio/identidad/credenciales.js";

export const NOMBRE_DE_LA_BASE = "cuaderno.db";

/** Lee y valida el archivo del pepper; los errores no muestran su contenido. */
export function leerElPepper(archivo: string): Uint8Array {
  let contenido: string;
  try {
    contenido = readFileSync(archivo, "utf8");
  } catch (e) {
    throw new ErrorDeConfiguracion(`no se puede leer el archivo del pepper (${archivo}): ${(e as NodeJS.ErrnoException).code ?? "error"}`);
  }
  try {
    return leerPepper(contenido);
  } catch (e) {
    throw new ErrorDeConfiguracion(`el archivo del pepper no sirve (${archivo}): ${(e as Error).message}`);
  }
}
