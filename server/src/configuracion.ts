// La configuración del servidor, leída del entorno y validada de una vez: si algo está mal, el servidor no arranca y dice todo lo que falta.

import { parsearVersion } from "./http/versiones.js";
import { leerNivel, type Nivel } from "./observabilidad/registro.js";

export interface Configuracion {
  /** Puerto en el que escucha. */
  readonly puerto: number;
  /** Carpeta de los datos (debe existir): ahí vive `cuaderno.db`. */
  readonly dirDatos: string;
  /** Carpeta de los archivos de los adjuntos (debe existir). */
  readonly dirAdjuntos: string;
  /** Archivo con el valor secreto de las huellas de códigos e IP. */
  readonly archivoPepper: string;
  readonly nivelDeLog: Nivel | "silent";
  /** Versión mínima de la app; sin valor, no se exige ninguna. */
  readonly versionMinima?: string;
}

export class ErrorDeConfiguracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeConfiguracion";
  }
}

const PUERTO_POR_DEFECTO = 8094;

/** `PORT`, `DATA_DIR`, `ADJUNTOS_DIR`, `PEPPER_FILE`, `LOG_LEVEL` y `APP_MIN_VERSION`; lanza `ErrorDeConfiguracion` con todos los problemas juntos. */
export function leerConfiguracion(env: Readonly<Record<string, string | undefined>>): Configuracion {
  const errores: string[] = [];
  const valor = (nombre: string): string => (env[nombre] ?? "").trim();

  let puerto = PUERTO_POR_DEFECTO;
  if (valor("PORT") !== "") {
    puerto = /^\d+$/.test(valor("PORT")) ? Number(valor("PORT")) : 0;
    if (puerto < 1 || puerto > 65535) errores.push(`PORT debe ser un número entre 1 y 65535 (llegó "${valor("PORT")}")`);
  }
  const dirDatos = valor("DATA_DIR");
  if (dirDatos === "") errores.push("falta DATA_DIR (la carpeta de los datos)");
  const dirAdjuntos = valor("ADJUNTOS_DIR");
  if (dirAdjuntos === "") errores.push("falta ADJUNTOS_DIR (la carpeta de los archivos adjuntos)");
  const archivoPepper = valor("PEPPER_FILE");
  if (archivoPepper === "") errores.push("falta PEPPER_FILE (el archivo con el valor secreto)");
  let nivelDeLog: Configuracion["nivelDeLog"] = "info";
  try {
    nivelDeLog = leerNivel(env.LOG_LEVEL);
  } catch (e) {
    errores.push((e as Error).message);
  }
  const versionMinima = valor("APP_MIN_VERSION");
  if (versionMinima !== "" && parsearVersion(versionMinima) === null) errores.push(`APP_MIN_VERSION no es una versión (llegó "${versionMinima}")`);

  if (errores.length > 0) throw new ErrorDeConfiguracion(`configuración inválida: ${errores.join("; ")}`);
  return { puerto, dirDatos, dirAdjuntos, archivoPepper, nivelDeLog, ...(versionMinima === "" ? {} : { versionMinima }) };
}
