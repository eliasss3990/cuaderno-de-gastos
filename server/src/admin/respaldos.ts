// Respaldos de la base: copia consistente con VACUUM INTO (sin parar el servicio), verificada, con nombre único y
// rotación por motivo; y restauración (con el servicio detenido). Los adjuntos los copia el script del host (rsync).

import { copyFileSync, existsSync, fsyncSync, openSync, closeSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database, { type Database as Base } from "better-sqlite3";
import { ErrorDeServicio } from "../dominio/identidad/servicioIdentidad.js";
import { verificarRespaldo } from "./verificar.js";

/** Cuántos respaldos de cada motivo se conservan (los más recientes): 15 como máximo en total. */
export const CONSERVAR: Readonly<Record<string, number>> = {
  diario: 7,
  semanal: 4,
  predeploy: 2,
  premigracion: 1,
  prerestauracion: 1,
};

/** Los motivos que se pueden pedir a mano (los demás los usa el propio servidor o `restaurar`). */
export const MOTIVOS_DE_BACKUP = ["diario", "semanal", "predeploy"] as const;

const FORMA = /^(\d{4}-\d{2}-\d{2}T\d{6})-([a-z]+)\.sqlite$/;

/** `AAAA-MM-DDTHHMMSS-<motivo>.sqlite` en UTC: ordenar por nombre es ordenar por fecha. */
export function nombreDeRespaldo(ahoraMs: number, motivo: string): string {
  const iso = new Date(ahoraMs).toISOString(); // AAAA-MM-DDTHH:MM:SS.mmmZ
  return `${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}-${motivo}.sqlite`;
}

/** Los respaldos de un motivo, del más nuevo al más viejo. */
export function respaldosDe(dir: string, motivo: string): string[] {
  return readdirSync(dir)
    .filter((n) => FORMA.exec(n)?.[2] === motivo)
    // los nombres empiezan con la fecha: del más nuevo al más viejo
    .sort((a, b) => b.localeCompare(a, "en"));
}

/** Copia la base a `dir`, verifica la copia y rota los de su motivo. Si la copia no verifica, la conserva y lo informa. */
export function hacerRespaldo(db: Base, dir: string, motivo: string, ahoraMs: number): { readonly archivo: string; readonly problemas: string[]; readonly borrados: string[] } {
  if (!Object.hasOwn(CONSERVAR, motivo)) throw new ErrorDeServicio("formato_invalido", `motivo desconocido: ${motivo}`);
  if (!existsSync(dir)) throw new ErrorDeServicio("no_existe", `no existe la carpeta de respaldos (${dir})`);
  const archivo = join(dir, nombreDeRespaldo(ahoraMs, motivo));
  // VACUUM INTO falla si el archivo ya existe: dos respaldos del mismo motivo en el mismo segundo no se pisan
  if (existsSync(archivo)) throw new ErrorDeServicio("formato_invalido", `ya existe un respaldo con ese nombre (${archivo}); esperar un segundo`);
  copiarA(db, archivo);
  const problemas = verificarRespaldo(archivo);
  if (problemas.length > 0) {
    // uno roto no cuenta como respaldo: con otro nombre no ocupa lugar en la rotación ni empuja afuera a uno bueno;
    // de los rotos de cada motivo queda solo el último (para investigar), así tampoco se acumulan
    for (const viejo of readdirSync(dir).filter((n) => n.endsWith(`-${motivo}.sqlite.roto`))) rmSync(join(dir, viejo));
    renameSync(archivo, `${archivo}.roto`);
    return { archivo: `${archivo}.roto`, problemas, borrados: [] };
  }
  return { archivo, problemas, borrados: rotar(dir, motivo) };
}

/** Una copia de seguridad de menos de esto no se reemplaza: un reinicio en bucle o un reintento la pisaría con una peor. */
export const COPIA_RECIENTE_MS = 60 * 60 * 1000;

/** La copia más nueva de un motivo si tiene menos de una hora (por la hora de su nombre). */
function copiaReciente(dir: string, motivo: string, ahoraMs: number): string | null {
  const ultima = respaldosDe(dir, motivo)[0];
  if (ultima === undefined) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})-/.exec(ultima);
  if (m === null) return null;
  const hecha = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return ahoraMs - hecha < COPIA_RECIENTE_MS ? join(dir, ultima) : null;
}

/**
 * Copia previa a una migración. Queda en la versión vieja, así que no se verifica (`verificar` exige la actual). Si ya
 * hay una de menos de una hora (el servidor se reinicia en bucle con una migración a medias) no se reemplaza: esa es la
 * buena. Devuelve el archivo que queda.
 */
export function copiarAntesDeMigrar(db: Base, dir: string, ahoraMs: number): string {
  const reciente = copiaReciente(dir, "premigracion", ahoraMs);
  if (reciente !== null) return reciente;
  const archivo = join(dir, nombreDeRespaldo(ahoraMs, "premigracion"));
  copiarA(db, archivo);
  rotar(dir, "premigracion");
  return archivo;
}

/**
 * Copia la base que se va a reemplazar, tal como esté: puede estar en una versión de esquema más nueva (la reversa de un
 * despliegue que migró) o dañada. Sin verificar; si no se puede copiar se avisa y la restauración sigue.
 */
function copiarLaBaseActual(ruta: string, dir: string, ahoraMs: number): string {
  // un reintento de restaurar no debe pisar la copia de la base que se reemplazó la primera vez
  const reciente = copiaReciente(dir, "prerestauracion", ahoraMs);
  if (reciente !== null) return `la base anterior ya quedó en ${reciente} (de hace menos de una hora: no se reemplaza)`;
  const archivo = join(dir, nombreDeRespaldo(ahoraMs, "prerestauracion"));
  try {
    const db = new Database(ruta, { fileMustExist: true });
    try {
      copiarA(db, archivo);
    } finally {
      db.close();
    }
    rotar(dir, "prerestauracion");
    return `la base anterior quedó en ${archivo}`;
  } catch (e) {
    return `aviso: no se pudo copiar la base anterior (${(e as Error).message}); se restaura igual`;
  }
}

/** VACUUM INTO a un temporal y rename: una copia a medias nunca queda con un nombre de respaldo válido. */
function copiarA(db: Base, archivo: string): void {
  const temporal = `${archivo}.tmp`;
  rmSync(temporal, { force: true });
  db.prepare("VACUUM INTO ?").run(temporal);
  renameSync(temporal, archivo);
}

function rotar(dir: string, motivo: string): string[] {
  const sobrantes = respaldosDe(dir, motivo).slice(CONSERVAR[motivo] ?? Number.POSITIVE_INFINITY);
  for (const n of sobrantes) rmSync(join(dir, n));
  return sobrantes;
}

/**
 * Reemplaza la base viva por un respaldo verificado. El servicio debe estar detenido (lo comprueba quien llama). Antes
 * guarda una copia de la base actual (`prerestauracion`) si hay una. El cambio es un rename: o queda la vieja o la nueva.
 */
export function restaurar(desde: string, rutaDeLaBase: string, dirRespaldos: string, ahoraMs: number): string[] {
  // uno de una versión anterior también sirve (después de una migración, los respaldos viejos): lo migra el arranque
  const problemas = verificarRespaldo(desde, true);
  if (problemas.length > 0) throw new ErrorDeServicio("formato_invalido", `el respaldo no verifica, no se restaura: ${problemas.join("; ")}`);
  const lineas: string[] = [];
  if (existsSync(rutaDeLaBase)) lineas.push(copiarLaBaseActual(rutaDeLaBase, dirRespaldos, ahoraMs));
  const temporal = `${rutaDeLaBase}.restaurando`;
  copyFileSync(desde, temporal);
  const fd = openSync(temporal, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // los -wal y -shm de la base anterior no deben aplicarse sobre la restaurada
  for (const sufijo of ["-wal", "-shm"]) rmSync(`${rutaDeLaBase}${sufijo}`, { force: true });
  renameSync(temporal, rutaDeLaBase);
  // el cambio de nombre es durable recién cuando se escribe la carpeta
  const carpeta = openSync(dirname(rutaDeLaBase), "r");
  try {
    fsyncSync(carpeta);
  } finally {
    closeSync(carpeta);
  }
  lineas.push(`restaurada desde ${desde}`);
  return lineas;
}
