// Rutas de sincronización: subir operaciones, bajar los cambios y conocer la cabeza del viaje. Solo las ve el dispositivo
// del viaje (con otro viaje en el camino, 404). Los números de la URL llegan como texto: se validan con un patrón.

import type { FastifyInstance } from "fastify";
import type { ServicioDeIdentidad } from "../dominio/identidad/servicioIdentidad.js";
import type { CanalEnVivo } from "../dominio/operaciones/canalEnVivo.js";
import type { Metricas } from "../observabilidad/metricas.js";
import { ErrorHttp } from "./errores.js";
import { EscritorSse } from "./escritorSse.js";
import { MAX_OPERACIONES_POR_LOTE } from "../dominio/operaciones/recepcion.js";
import { MAX_OPERACIONES_POR_PAGINA, type ServicioDeSincronizacion } from "../dominio/operaciones/sincronizacion.js";
import { delViaje, exigirDispositivo } from "./autenticacion.js";

/** Una operación entera puede pesar unos KB (el payload de un gasto): el tope de 100 por lote cabe holgado en 512 KB. */
export const LIMITE_DEL_LOTE_BYTES = 512 * 1024;

const SUBIR = {
  type: "object",
  additionalProperties: false,
  required: ["ops"],
  // el contenido de cada operación lo juzga la ingesta (un rechazo no frena a las demás): acá solo que sea una lista de 1 a 100
  properties: { ops: { type: "array", minItems: 1, maxItems: MAX_OPERACIONES_POR_LOTE, items: {} } },
} as const;

const NUMERO = { type: "string", pattern: "^\\d{1,15}$" } as const;
const CAMBIOS = { type: "object", additionalProperties: false, properties: { after: NUMERO, limit: NUMERO } } as const;

/** Una operación del cable (snake_case) como la entiende el dominio; lo que no es un objeto pasa igual y lo rechaza la ingesta. */
function delCable(op: unknown): unknown {
  if (op === null || typeof op !== "object" || Array.isArray(op)) return op;
  const o = op as Record<string, unknown>;
  return { opId: o.op_id, tipo: o.type, entidadTipo: o.entity_type, entidadId: o.entity_id, hlc: o.hlc, payload: o.payload };
}

/** Cada cuánto se escribe un comentario para que ni nginx ni Cloudflare corten una conexión sin novedades. */
export const LATIDO_MS = 20_000;
export interface DependenciasDeRutas {
  readonly identidad: ServicioDeIdentidad;
  readonly sincronizacion: ServicioDeSincronizacion;
  readonly canal: CanalEnVivo;
  readonly metricas: Metricas;
  readonly ahora: () => number;
  readonly latidoMs?: number;
}

export function rutasDeSincronizacion(app: FastifyInstance, dep: DependenciasDeRutas): void {
  const { identidad, sincronizacion, canal, metricas, ahora } = dep;
  const auth = exigirDispositivo(identidad);

  app.post<{ Params: { trip: string }; Body: { ops: unknown[] } }>(
    "/v1/trips/:trip/ops",
    { onRequest: auth, bodyLimit: LIMITE_DEL_LOTE_BYTES, schema: { body: SUBIR } },
    (request) => {
      const actor = delViaje(request.params.trip, request.dispositivo);
      const resultados = sincronizacion.subir(actor, request.body.ops.map(delCable));
      for (const r of resultados) {
        metricas.contar("ops", 1, r.estado === "rejected" ? { resultado: "rechazada", razon: r.razon ?? "desconocida" } : { resultado: r.estado === "accepted" ? "aceptada" : "duplicada" });
      }
      return {
        resultados: resultados.map((r) => ({ op_id: r.opId, estado: r.estado, ...(r.seq === undefined ? {} : { server_seq: r.seq }), ...(r.razon === undefined ? {} : { razon: r.razon }), hlc: r.hlc })),
      };
    },
  );

  app.get<{ Params: { trip: string }; Querystring: { after?: string; limit?: string } }>(
    "/v1/trips/:trip/changes",
    { onRequest: auth, schema: { querystring: CAMBIOS } },
    (request) => {
      const actor = delViaje(request.params.trip, request.dispositivo);
      const pagina = sincronizacion.bajar(actor, Number(request.query.after ?? "0"), Number(request.query.limit ?? String(MAX_OPERACIONES_POR_PAGINA)));
      return {
        ops: pagina.ops.map((o) => ({ server_seq: o.seq, op_id: o.opId, type: o.tipo, entity_type: o.entidadTipo, entity_id: o.entidadId, hlc: o.hlc, payload: o.payload, redacted: o.redactada })),
        next: pagina.siguiente,
        hay_mas: pagina.hayMas,
        head_seq: pagina.cabeza,
        ahora: ahora(),
      };
    },
  );

  app.get<{ Params: { trip: string } }>("/v1/trips/:trip/head", { onRequest: auth }, (request) => {
    const actor = delViaje(request.params.trip, request.dispositivo);
    return { head_seq: sincronizacion.cabeza(actor), ahora: ahora() };
  });

  // Canal en vivo (SSE) escrito a mano: la respuesta no termina, así que se toma el control del socket (`hijack`) y no pasa por
  // `onResponse`; abrir y cerrar quedan en el registro y en las métricas de conexiones. Lo que puede fallar (el lugar, la cabeza)
  // se resuelve ANTES del hijack para que un error salga como 500 normal. Todo es síncrono: entre leer la cabeza y suscribir no
  // se puede intercalar una subida, así que no se pierde ni se adelanta ningún aviso.
  app.get<{ Params: { trip: string } }>("/v1/trips/:trip/events", { onRequest: auth }, (request, reply) => {
    // si el cliente se fue mientras se autenticaba, su `close` ya pasó: no se suscribe a un socket muerto
    if (request.raw.destroyed) return;
    const actor = delViaje(request.params.trip, request.dispositivo);
    if (!canal.hayLugar(actor.tripId, actor.deviceId)) throw new ErrorHttp(503, "canal_lleno", "no hay lugar para otra conexión en vivo");
    const cabeza = sincronizacion.cabeza(actor);
    void reply.hijack();
    const raw = reply.raw;
    const escritor = new EscritorSse(raw);
    const latido = setInterval(() => escritor.latido(), dep.latidoMs ?? LATIDO_MS);
    latido.unref();
    const abierto = ahora();
    let baja = (): void => {};
    let terminado = false;
    const limpiar = (): void => {
      if (terminado) return;
      terminado = true;
      escritor.marcarCerrado();
      clearInterval(latido);
      baja();
      metricas.fijar("sse_conexiones", canal.conexiones());
      request.registro.info("canal_cerrado", { ms: Math.round(ahora() - abierto) });
    };
    raw.on("close", limpiar);
    raw.on("error", () => raw.destroy());
    raw.on("drain", () => escritor.vaciada());
    try {
      raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", "x-accel-buffering": "no", connection: "keep-alive" });
      baja = canal.suscribir(actor.tripId, actor.deviceId, { novedades: (c) => escritor.novedades(c), cerrar: () => escritor.cerrar() });
      metricas.fijar("sse_conexiones", canal.conexiones());
      metricas.contar("sse_aperturas");
      request.registro.info("canal_abierto");
      escritor.abrir(cabeza);
    } catch (e) {
      // ya no hay respuesta HTTP posible: se registra y se corta el socket (el `close` hace la limpieza)
      request.registro.error("canal_fallo", { err: e });
      raw.destroy();
    }
  });
}
