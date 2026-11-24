import type { FastifyInstance } from "fastify";
import { abrirBase } from "../../src/almacen/base/base.js";
import { IdentidadSqlite } from "../../src/almacen/identidad/identidadSqlite.js";
import { servicioDeIdentidadSobre } from "../../src/almacen/identidad/servicioSqlite.js";
import { construirApi } from "../../src/api.js";
import type { Aleatorio } from "../../src/dominio/identidad/credenciales.js";
import type { ServicioDeIdentidad } from "../../src/dominio/identidad/servicioIdentidad.js";
import { AlmacenSqlite } from "../../src/almacen/operaciones/almacenSqlite.js";
import { ServicioDeAdjuntos } from "../../src/dominio/adjuntos/servicioAdjuntos.js";
import { ArchivosEnMemoria } from "./archivosEnMemoria.js";
import { CanalEnMemoria } from "../../src/dominio/operaciones/canalEnVivo.js";
import { ServicioDeSincronizacion } from "../../src/dominio/operaciones/sincronizacion.js";
import { MetricasEnMemoria } from "../../src/observabilidad/metricas.js";
import { RegistroDeMemoria } from "./registroDeMemoria.js";

export const AHORA = 1802000000000;
export const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

export const VIAJE = {
  nombre: "Brasil 2027",
  zona_horaria: "America/Asuncion",
  monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$" }],
  nombre_dispositivo: "Poco X7",
  apodo: "Papá",
  color: "#E8E4F3",
  emoji: "🧔",
};
export const NUEVO = { nombre_dispositivo: "Celular de Ana", apodo: "Ana", color: "#FFE4E1", emoji: "👩" };

/** Una fuente de azar determinista pero distinta en cada llamada (no es segura: solo para pruebas). */
function azarDeterminista(): Aleatorio {
  let n = 0;
  return (cantidad) => Uint8Array.from({ length: cantidad }, () => (n++ * 37 + 11) & 255);
}

export interface Alta {
  trip_id: string;
  device_id: string;
  member_id: string;
  token: string;
}

/** La API armada sobre una base en memoria, con registro y métricas para inspeccionar. Las métricas son estrictas: una etiqueta inválida salta. */
export function entornoApi(opciones: { canal?: CanalEnMemoria; latidoMs?: number; versionMinima?: string; servicio?: ServicioDeIdentidad; reloj?: () => number } = {}) {
  const db = abrirBase(":memory:");
  const identidad = new IdentidadSqlite(db);
  const reloj = { ahora: AHORA };
  const servicio = opciones.servicio ?? servicioDeIdentidadSobre(db, { ahora: () => reloj.ahora, pepper: PEPPER, aleatorio: azarDeterminista() });
  const canal = opciones.canal ?? new CanalEnMemoria();
  const sincronizacion = new ServicioDeSincronizacion({ almacenDe: (tripId) => new AlmacenSqlite(db, tripId), ahora: () => reloj.ahora, canal });
  const archivos = new ArchivosEnMemoria();
  const adjuntos = new ServicioDeAdjuntos({ almacenDe: (tripId) => new AlmacenSqlite(db, tripId), archivos });
  const registro = new RegistroDeMemoria();
  const metricas = new MetricasEnMemoria();
  const app: FastifyInstance = construirApi({ servicio, sincronizacion, adjuntos, canal, ...(opciones.latidoMs === undefined ? {} : { latidoMs: opciones.latidoMs }), ahora: () => reloj.ahora, registro, metricas, ...(opciones.versionMinima === undefined ? {} : { versionMinima: opciones.versionMinima }), ...(opciones.reloj === undefined ? {} : { reloj: opciones.reloj }) });
  const con = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });

  async function crearViaje(cuerpo: object = VIAJE): Promise<Alta> {
    const r = await app.inject({ method: "POST", url: "/v1/trips", payload: cuerpo });
    if (r.statusCode !== 201) throw new Error(`crear el viaje dio ${r.statusCode}: ${r.body}`);
    return r.json<Alta>();
  }
  async function invitar(token: string, trip: string, cuerpo: object = {}) {
    const r = await app.inject({ method: "POST", url: `/v1/trips/${trip}/invitations`, headers: con(token), payload: cuerpo });
    return { estado: r.statusCode, cuerpo: r.json<{ codigo: string; vence_en: number }>() };
  }
  async function unirse(codigo: unknown, extra: object = NUEVO, cabeceras: Record<string, string> = {}) {
    return app.inject({ method: "POST", url: "/v1/join", headers: cabeceras, payload: { codigo, ...extra } });
  }
  /** Un integrante nuevo ya unido al viaje del organizador. */
  async function sumar(organizador: Alta, extra: object = NUEVO): Promise<Alta> {
    const { cuerpo } = await invitar(organizador.token, organizador.trip_id);
    const r = await unirse(cuerpo.codigo, extra);
    if (r.statusCode !== 201) throw new Error(`unirse dio ${r.statusCode}: ${r.body}`);
    return r.json<Alta>();
  }
  const contador = (nombre: string, etiquetas: Record<string, string>) =>
    metricas.resumen().contadores.find((s) => s.nombre === nombre && JSON.stringify(s.etiquetas) === JSON.stringify(etiquetas))?.valor;

  return { app, db, identidad, reloj, servicio, sincronizacion, adjuntos, archivos, canal, registro, metricas, con, crearViaje, invitar, unirse, sumar, contador };
}
