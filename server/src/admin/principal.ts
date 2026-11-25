// Punto de entrada de la administración: configuración y pepper como el servidor, la misma base, y un código de salida.

import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { restaurar } from "./respaldos.js";
import { join } from "node:path";
import { abrirBase } from "../almacen/base/base.js";
import { pepperDeLaBase } from "../almacen/base/pepper.js";
import { servicioDeIdentidadSobre } from "../almacen/identidad/servicioSqlite.js";
import { leerElPepper, NOMBRE_DE_LA_BASE } from "../archivosDelServidor.js";
import { ErrorDeConfiguracion, leerConfiguracion, type Configuracion } from "../configuracion.js";
import { ErrorDeServicio } from "../dominio/identidad/servicioIdentidad.js";
import { AYUDA, ejecutar, ErrorDeUso, esPedidoDeAyuda, leerArgumentos, ResultadoConProblemas } from "./comandos.js";

export const SALIDA_OK = 0;
export const SALIDA_ERROR = 1;
export const SALIDA_FALLO = 2;
/** Como `EX_USAGE` de sysexits: el comando o sus opciones están mal. */
export const SALIDA_USO = 64;

export interface Consola {
  readonly salida: (linea: string) => void;
  readonly error: (linea: string) => void;
}

/** Abre solo una base que ya existe y ya está en la versión de este código: nunca la crea ni la migra. */
function abrirLaBase(ruta: string) {
  try {
    return abrirBase(ruta, { soloExistente: true, sinMigrar: true });
  } catch (e) {
    const codigo = (e as { code?: unknown }).code;
    if (codigo === "SQLITE_CANTOPEN") {
      if (!existsSync(ruta)) throw new ErrorDeConfiguracion(`no hay una base en ${ruta}: ¿DATA_DIR es la del servidor y el servidor arrancó alguna vez?`);
      throw new ErrorDeConfiguracion(`no se puede abrir la base en ${ruta} (¿permisos o volumen mal montado?)`);
    }
    throw new ErrorDeConfiguracion(`no se puede administrar esta base: ${(e as Error).message}`);
  }
}

/** Espera máxima para saber si el servidor sigue corriendo antes de restaurar. */
const ESPERA_DE_LA_SALUD_MS = 2000;

/**
 * Restaurar exige el servidor detenido (si responde en su puerto, se niega), un respaldo que verifique y que tenga la
 * huella del pepper actual (si no, el servidor no arrancaría después).
 */
async function restaurarDesde(desde: string, config: Configuracion, pepper: Uint8Array, ahora: () => number, pedir: typeof fetch): Promise<string[]> {
  const corriendo = await pedir(`http://127.0.0.1:${config.puerto}/healthz`, { signal: AbortSignal.timeout(ESPERA_DE_LA_SALUD_MS) }).then(
    () => true,
    () => false,
  );
  if (corriendo) throw new ErrorDeConfiguracion("el servidor está corriendo: detenerlo antes de restaurar (docker compose stop cuaderno-server)");
  if (config.dirRespaldos === undefined) throw new ErrorDeConfiguracion("falta BACKUP_DIR (ahí queda una copia de la base actual antes de reemplazarla)");
  if (!existsSync(desde)) throw new ErrorDeConfiguracion(`no existe el respaldo ${desde}`);
  let huella: ReturnType<typeof pepperDeLaBase>;
  try {
    const respaldo = new Database(desde, { readonly: true, fileMustExist: true });
    try {
      const conTabla = respaldo.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'servidor_parametro'").get() !== undefined;
      huella = conTabla ? pepperDeLaBase(respaldo, pepper) : "sin_huella";
    } finally {
      respaldo.close();
    }
  } catch (e) {
    throw new ErrorDeConfiguracion(`el respaldo no es una base del servidor: ${(e as Error).message}`);
  }
  if (huella === "distinto") throw new ErrorDeConfiguracion("el respaldo no tiene la huella del pepper actual: con este pepper el servidor no arrancaría");
  const lineas = restaurar(desde, join(config.dirDatos, NOMBRE_DE_LA_BASE), config.dirRespaldos, ahora());
  // un respaldo de antes de la huella no se puede comprobar: el servidor registra el pepper actual al arrancar
  return huella === "sin_huella" ? [...lineas, "aviso: el respaldo es de antes de la huella del pepper; si el pepper cambió desde entonces, las invitaciones viejas no sirven"] : lineas;
}

export async function principal(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  consola: Consola,
  ahora: () => number = Date.now,
  pedir?: typeof fetch,
): Promise<number> {
  if (esPedidoDeAyuda(argv)) {
    for (const linea of AYUDA) consola.salida(linea);
    return SALIDA_OK;
  }
  try {
    const { comando, opciones } = leerArgumentos(argv); // un error de uso se muestra aunque falte la configuración
    const config = leerConfiguracion(env);
    const pepper = leerElPepper(config.archivoPepper);
    if (comando === "restaurar") {
      const desde = opciones.get("desde");
      if (desde === undefined) throw new ErrorDeUso("falta --desde");
      for (const linea of await restaurarDesde(desde, config, pepper, ahora, pedir ?? fetch)) consola.salida(linea);
      return SALIDA_OK;
    }
    const db = abrirLaBase(join(config.dirDatos, NOMBRE_DE_LA_BASE));
    try {
      // la administración no registra ni reemplaza la huella del pepper: eso es del arranque del servidor
      const pepperGuardado = pepperDeLaBase(db, pepper);
      if (pepperGuardado === "distinto") throw new ErrorDeConfiguracion("el pepper no coincide con el que usó esta base");
      if (pepperGuardado === "sin_huella") throw new ErrorDeConfiguracion("la base todavía no tiene la huella del pepper: arrancá el servidor una vez antes de administrarla");
      const entorno = {
        db,
        servicio: servicioDeIdentidadSobre(db, { ahora, pepper }),
        ahora,
        puerto: config.puerto,
        dirAdjuntos: config.dirAdjuntos,
        ...(config.dirRespaldos === undefined ? {} : { dirRespaldos: config.dirRespaldos }),
      };
      for (const linea of await ejecutar(argv, pedir === undefined ? entorno : { ...entorno, pedir })) consola.salida(linea);
      return SALIDA_OK;
    } finally {
      db.close();
    }
  } catch (e) {
    if (e instanceof ResultadoConProblemas) {
      for (const linea of e.lineas) consola.error(linea);
      return SALIDA_ERROR;
    }
    if (e instanceof ErrorDeUso) {
      consola.error(e.message);
      for (const linea of AYUDA) consola.error(linea);
      return SALIDA_USO;
    }
    if (e instanceof ErrorDeServicio || e instanceof ErrorDeConfiguracion) {
      consola.error(e.message);
      return SALIDA_ERROR;
    }
    consola.error(`falló: ${e instanceof Error ? e.message : String(e)}`);
    return SALIDA_FALLO;
  }
}
