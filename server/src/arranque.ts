// El arranque del servidor: arma la base, el pepper, el registro, las métricas, el servicio de identidad y la API, y sabe detenerlos en orden.

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { abrirBase } from "./almacen/base/base.js";
import { servicioDeIdentidadSobre } from "./almacen/identidad/servicioSqlite.js";
import { construirApi } from "./api.js";
import { ErrorDeConfiguracion, type Configuracion } from "./configuracion.js";
import { leerPepper } from "./dominio/identidad/credenciales.js";
import type { ServicioDeIdentidad } from "./dominio/identidad/servicioIdentidad.js";
import { AlmacenSqlite } from "./almacen/operaciones/almacenSqlite.js";
import { CanalEnMemoria } from "./dominio/operaciones/canalEnVivo.js";
import { ServicioDeSincronizacion } from "./dominio/operaciones/sincronizacion.js";
import { iniciarResumenPeriodico, MAX_SERIES, MetricasEnMemoria } from "./observabilidad/metricas.js";
import { tareaPeriodica, type OpcionesPeriodicas } from "./observabilidad/periodico.js";
import type { Registro } from "./observabilidad/registro.js";
import { crearRegistroPino, type OpcionesDelRegistro } from "./observabilidad/registroPino.js";

export const NOMBRE_DE_LA_BASE = "cuaderno.db";
export const CADA_DIEZ_MINUTOS_MS = 10 * 60 * 1000;
/** Docker manda SIGKILL a los 10 s: pasado este plazo se cortan las conexiones que sigan abiertas para poder cerrar la base. */
export const PLAZO_DE_APAGADO_MS = 8000;

export interface Servidor {
  readonly app: FastifyInstance;
  /** El puerto en el que escucha (útil cuando se pidió el 0). */
  readonly puerto: number;
  /** Detiene los temporizadores, deja de atender y cierra la base. Se puede llamar más de una vez. */
  detener(): Promise<void>;
}

/** Borra cada tanto los intentos de unirse que ya salieron de la ventana. Devuelve la función que lo detiene. */
export function iniciarMantenimiento(opciones: {
  servicio: Pick<ServicioDeIdentidad, "mantenimiento">;
  registro: Registro;
  periodo?: Partial<OpcionesPeriodicas>;
}): () => void {
  const accion = (): void => {
    try {
      const borrados = opciones.servicio.mantenimiento();
      if (borrados > 0) opciones.registro.info("mantenimiento", { intentos_borrados: borrados });
      else opciones.registro.debug("mantenimiento", { intentos_borrados: 0 });
    } catch (err) {
      opciones.registro.error("mantenimiento_fallo", { err });
    }
  };
  return tareaPeriodica(accion, { cadaMs: CADA_DIEZ_MINUTOS_MS, ...opciones.periodo });
}

function leerElPepper(archivo: string): Uint8Array {
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

function comprobarLaCarpeta(dir: string): void {
  let esCarpeta = false;
  try {
    esCarpeta = statSync(dir).isDirectory();
  } catch {
    /* no existe o no se puede leer */
  }
  if (!esCarpeta) throw new ErrorDeConfiguracion(`DATA_DIR no es una carpeta que exista (${dir})`);
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new ErrorDeConfiguracion(`DATA_DIR no se puede escribir (${dir})`);
  }
}

export async function arrancar(config: Configuracion, opciones: { registro?: Registro; destino?: OpcionesDelRegistro["destino"]; plazoDeApagadoMs?: number } = {}): Promise<Servidor> {
  const registro = opciones.registro ?? crearRegistroPino({ nivel: config.nivelDeLog, ...(opciones.destino === undefined ? {} : { destino: opciones.destino }) });
  comprobarLaCarpeta(config.dirDatos);
  const pepper = leerElPepper(config.archivoPepper);

  const db: Database = abrirBase(join(config.dirDatos, NOMBRE_DE_LA_BASE));
  const temporizadores: (() => void)[] = [];
  let app: FastifyInstance | undefined;
  /** Cierra en orden: los temporizadores, la API (deja terminar los pedidos en curso, hasta el plazo) y al final la base. */
  const cerrar = async (): Promise<void> => {
    for (const parar of temporizadores) parar();
    const cortar = setTimeout(() => app?.server.closeAllConnections(), opciones.plazoDeApagadoMs ?? PLAZO_DE_APAGADO_MS);
    try {
      await app?.close();
    } finally {
      clearTimeout(cortar);
      db.close();
    }
  };

  try {
    const metricas = new MetricasEnMemoria(MAX_SERIES, false);
    const servicio = servicioDeIdentidadSobre(db, { ahora: () => Date.now(), pepper });
    const canal = new CanalEnMemoria();
    const sincronizacion = new ServicioDeSincronizacion({ almacenDe: (tripId) => new AlmacenSqlite(db, tripId), ahora: () => Date.now(), canal });
    temporizadores.push(iniciarResumenPeriodico({ metricas, registro }), iniciarMantenimiento({ servicio, registro }));
    app = construirApi({ servicio, sincronizacion, canal, registro, metricas, ...(config.versionMinima === undefined ? {} : { versionMinima: config.versionMinima }) });
    await app.listen({ port: config.puerto, host: "0.0.0.0" });

    const direccion = app.server.address();
    const puerto = typeof direccion === "object" && direccion !== null ? direccion.port : config.puerto;
    registro.info("servidor_iniciado", { puerto, version_minima: config.versionMinima ?? "ninguna" });
    let detenido: Promise<void> | null = null;
    return {
      app,
      puerto,
      detener: () =>
        (detenido ??= (async () => {
          await cerrar();
          registro.info("servidor_detenido");
        })()),
    };
  } catch (e) {
    try {
      await cerrar();
    } catch {
      /* el error que importa es el del arranque */
    }
    throw e;
  }
}
