// El arranque del servidor: arma la base, el pepper, el registro, las métricas, el servicio de identidad y la API, y sabe detenerlos en orden.

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { abrirBase } from "./almacen/base/base.js";
import { ArchivosEnDisco } from "./almacen/archivos/archivosEnDisco.js";
import { servicioDeIdentidadSobre } from "./almacen/identidad/servicioSqlite.js";
import { construirApi } from "./api.js";
import { ServicioDeAdjuntos } from "./dominio/adjuntos/servicioAdjuntos.js";
import { ErrorDeConfiguracion, type Configuracion } from "./configuracion.js";
import { leerPepper } from "./dominio/identidad/credenciales.js";
import type { ServicioDeIdentidad } from "./dominio/identidad/servicioIdentidad.js";
import { AlmacenSqlite } from "./almacen/operaciones/almacenSqlite.js";
import { CanalEnMemoria } from "./dominio/operaciones/canalEnVivo.js";
import { ServicioDeSincronizacion } from "./dominio/operaciones/sincronizacion.js";
import { ALERTA_DE_DISCO_BYTES, medirAlmacenamiento, type MedicionDeAlmacenamiento } from "./observabilidad/almacenamiento.js";
import { iniciarResumenPeriodico, MAX_SERIES, MetricasEnMemoria, type Metricas } from "./observabilidad/metricas.js";
import { tareaPeriodica, type OpcionesPeriodicas } from "./observabilidad/periodico.js";
import type { Registro } from "./observabilidad/registro.js";
import { crearRegistroPino, type OpcionesDelRegistro } from "./observabilidad/registroPino.js";
import { comprobarElPepper } from "./almacen/base/pepper.js";

export const NOMBRE_DE_LA_BASE = "cuaderno.db";
export const CADA_DIEZ_MINUTOS_MS = 10 * 60 * 1000;
export const CADA_HORA_MS = 60 * 60 * 1000;
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

/** Cuánto se espera, como mucho, a un barrido en curso al apagar (Docker mata el proceso a los 10 s). */
export const ESPERA_DEL_BARRIDO_MS = 2000;

/**
 * Cada tanto borra los archivos de adjuntos que sobran (de adjuntos purgados y subidas a medias). Nunca corren dos barridos a
 * la vez. `detener` para el temporizador y espera un momento al barrido que esté en curso.
 */
export function iniciarBarridoDeAdjuntos(opciones: {
  servicio: Pick<ServicioDeAdjuntos, "barrer">;
  registro: Registro;
  ahora?: () => number;
  periodo?: Partial<OpcionesPeriodicas>;
  esperaMs?: number;
}): { detener(): Promise<void> } {
  let enCurso: Promise<void> | null = null;
  const barrer = async (): Promise<void> => {
    try {
      const r = await opciones.servicio.barrer((opciones.ahora ?? Date.now)());
      const campos = {
        revisados: r.revisados,
        huerfanos_borrados: r.huerfanosBorrados,
        temporales_borrados: r.temporalesBorrados,
        bytes_liberados: r.bytesLiberados,
        sin_registro: r.sinRegistro,
        desconocidos: r.desconocidos,
        viajes_desconocidos: r.viajesDesconocidos,
        viajes_sin_cambios: r.viajesSinCambios,
        errores: r.errores,
      };
      if (r.errores > 0) opciones.registro.warn("adjuntos_barrido", campos);
      else if (r.huerfanosBorrados + r.temporalesBorrados > 0) opciones.registro.info("adjuntos_barrido", campos);
      else opciones.registro.debug("adjuntos_barrido", campos);
    } catch (err) {
      opciones.registro.error("adjuntos_barrido_fallo", { err });
    }
  };
  const parar = tareaPeriodica(
    () => {
      enCurso ??= barrer().finally(() => {
        enCurso = null;
      });
    },
    { cadaMs: CADA_HORA_MS, ...opciones.periodo },
  );
  return {
    detener: async () => {
      parar();
      if (enCurso === null) return;
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const espera = new Promise<void>((listo) => {
        temporizador = setTimeout(listo, opciones.esperaMs ?? ESPERA_DEL_BARRIDO_MS);
      });
      try {
        await Promise.race([enCurso, espera]);
      } finally {
        clearTimeout(temporizador);
      }
    },
  };
}

/** Aunque no haya cambios, el disco se mide una vez por día: el espacio libre también lo consume el resto del VPS. */
export const MEDICION_DIARIA_MS = 24 * 60 * 60 * 1000;

/**
 * Mide cuánto ocupa el servidor y cuánto disco queda: lo deja en las métricas y avisa en el registro cuando el disco entra o sale
 * de la alerta. Cada 10 minutos mira si hubo cambios (`huboCambios`, que se consume al leerse) y solo entonces mide; sin cambios,
 * mide una vez por día. `enAlerta` dice cómo quedó la última medición.
 */
export function iniciarMedicionDeAlmacenamiento(opciones: {
  medir: () => Promise<MedicionDeAlmacenamiento>;
  metricas: Metricas;
  registro: Registro;
  /** Si hubo escrituras desde la vez anterior; sin valor, se mide siempre. */
  huboCambios?: () => boolean;
  ahora?: () => number;
  periodo?: Partial<OpcionesPeriodicas>;
}): { detener: () => void; enAlerta: () => boolean; medirAhora: () => Promise<void> } {
  const ahora = opciones.ahora ?? Date.now;
  let alerta = false;
  let enCurso: Promise<void> | null = null;
  let ultimaMedicion = Number.NEGATIVE_INFINITY;
  const medir = async (): Promise<void> => {
    ultimaMedicion = ahora();
    try {
      const m = await opciones.medir();
      opciones.metricas.fijar("base_bytes", m.baseBytes);
      opciones.metricas.fijar("adjuntos_en_disco_bytes", m.adjuntosBytes);
      opciones.metricas.fijar("disco_libre_bytes", m.libreBytes);
      const ahoraEnAlerta = m.libreBytes < ALERTA_DE_DISCO_BYTES;
      if (ahoraEnAlerta && !alerta) opciones.registro.warn("disco_casi_lleno", { libre_bytes: m.libreBytes });
      if (!ahoraEnAlerta && alerta) opciones.registro.info("disco_recuperado", { libre_bytes: m.libreBytes });
      alerta = ahoraEnAlerta;
    } catch (err) {
      opciones.registro.error("almacenamiento_medicion_fallo", { err });
    }
  };
  const medirAhora = (): Promise<void> => {
    enCurso ??= medir().finally(() => {
      enCurso = null;
    });
    return enCurso;
  };
  const detener = tareaPeriodica(
    () => {
      // con una medición en vuelo no se consume la bandera: pudo leer los tamaños antes de esa escritura
      if (enCurso !== null) return;
      const hubo = opciones.huboCambios?.() ?? true;
      if (hubo || ahora() - ultimaMedicion >= MEDICION_DIARIA_MS) void medirAhora();
    },
    { cadaMs: CADA_DIEZ_MINUTOS_MS, ...opciones.periodo },
  );
  return { detener, enAlerta: () => alerta, medirAhora };
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

function comprobarLaCarpeta(dir: string, nombre: string): void {
  let esCarpeta = false;
  try {
    esCarpeta = statSync(dir).isDirectory();
  } catch {
    /* no existe o no se puede leer */
  }
  if (!esCarpeta) throw new ErrorDeConfiguracion(`${nombre} no es una carpeta que exista (${dir})`);
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new ErrorDeConfiguracion(`${nombre} no se puede escribir (${dir})`);
  }
}

export async function arrancar(
  config: Configuracion,
  opciones: {
    registro?: Registro;
    destino?: OpcionesDelRegistro["destino"];
    plazoDeApagadoMs?: number;
    /** Cada cuánto se barren los archivos de adjuntos que sobran; por defecto, cada hora. Lo usan las pruebas. */
    cadaMsDelBarrido?: number;
    /** Reemplaza la medición del disco (las pruebas simulan poco espacio libre). */
    medirAlmacenamiento?: () => Promise<MedicionDeAlmacenamiento>;
    /** Cada cuánto se mira si hay que medir el disco; por defecto, cada 10 minutos. Lo usan las pruebas. */
    cadaMsDeLaMedicion?: number;
  } = {},
): Promise<Servidor> {
  const registro = opciones.registro ?? crearRegistroPino({ nivel: config.nivelDeLog, ...(opciones.destino === undefined ? {} : { destino: opciones.destino }) });
  comprobarLaCarpeta(config.dirDatos, "DATA_DIR");
  comprobarLaCarpeta(config.dirAdjuntos, "ADJUNTOS_DIR");
  const pepper = leerElPepper(config.archivoPepper);

  const db: Database = abrirBase(join(config.dirDatos, NOMBRE_DE_LA_BASE));
  const temporizadores: (() => void)[] = [];
  let app: FastifyInstance | undefined;
  let barridoDeAdjuntos: { detener(): Promise<void> } | undefined;
  /** Cierra en orden: los temporizadores, la API (deja terminar los pedidos en curso, hasta el plazo) y al final la base. */
  const cerrar = async (): Promise<void> => {
    for (const parar of temporizadores) parar();
    await barridoDeAdjuntos?.detener();
    const cortar = setTimeout(() => app?.server.closeAllConnections(), opciones.plazoDeApagadoMs ?? PLAZO_DE_APAGADO_MS);
    try {
      await app?.close();
    } finally {
      clearTimeout(cortar);
      db.close();
    }
  };

  try {
    const pepperGuardado = comprobarElPepper(db, pepper, config.aceptarPepperNuevo);
    if (pepperGuardado.estado === "distinto") {
      throw new ErrorDeConfiguracion(
        "el pepper no coincide con el que usó esta base: si se cambió a propósito, arrancar una vez con ACEPTAR_PEPPER_NUEVO=1 (borra las invitaciones sin usar y los intentos de unirse)",
      );
    }
    if (pepperGuardado.estado === "registrado") registro.info("pepper_registrado", {});
    // la bandera es de un solo arranque: si quedó puesta, un cambio de pepper por error pasaría sin frenar
    if (config.aceptarPepperNuevo && pepperGuardado.estado !== "reemplazado") registro.warn("aceptar_pepper_nuevo_activo", {});
    if (pepperGuardado.estado === "reemplazado") {
      registro.warn("pepper_reemplazado", { pendientes_borrados: pepperGuardado.invitacionesBorradas, intentos_borrados: pepperGuardado.intentosBorrados });
    }
    const metricas = new MetricasEnMemoria(MAX_SERIES, false);
    const servicio = servicioDeIdentidadSobre(db, { ahora: () => Date.now(), pepper });
    const canal = new CanalEnMemoria();
    const sincronizacion = new ServicioDeSincronizacion({ almacenDe: (tripId) => new AlmacenSqlite(db, tripId), ahora: () => Date.now(), canal });
    const archivosEnDisco = new ArchivosEnDisco(config.dirAdjuntos);
    const adjuntos = new ServicioDeAdjuntos({ almacenDe: (tripId) => new AlmacenSqlite(db, tripId), archivos: archivosEnDisco });
    // cualquier escritura que salió bien (operaciones, subidas, altas, invitaciones, revocaciones) puede cambiar lo que ocupa
    let huboEscritura = false;
    const almacenamiento = iniciarMedicionDeAlmacenamiento({
      medir:
        opciones.medirAlmacenamiento ??
        (() => medirAlmacenamiento({ archivoBase: join(config.dirDatos, NOMBRE_DE_LA_BASE), dirDatos: config.dirDatos, dirAdjuntos: config.dirAdjuntos }, archivosEnDisco)),
      metricas,
      registro,
      huboCambios: () => {
        const hubo = huboEscritura;
        huboEscritura = false;
        return hubo;
      },
      ...(opciones.cadaMsDeLaMedicion === undefined ? {} : { periodo: { cadaMs: opciones.cadaMsDeLaMedicion } }),
    });
    temporizadores.push(almacenamiento.detener);
    void almacenamiento.medirAhora();
    temporizadores.push(iniciarResumenPeriodico({ metricas, registro }), iniciarMantenimiento({ servicio, registro }));
    barridoDeAdjuntos = iniciarBarridoDeAdjuntos({
      servicio: adjuntos,
      registro,
      ...(opciones.cadaMsDelBarrido === undefined 
        ? {} 
        : { periodo: { cadaMs: opciones.cadaMsDelBarrido } }
      ),
    });
    app = construirApi({ servicio, sincronizacion, adjuntos, canal, registro, metricas, discoEnAlerta: almacenamiento.enAlerta, alEscribir: () => { huboEscritura = true; }, ...(config.versionMinima === undefined ? {} : { versionMinima: config.versionMinima }) });
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
