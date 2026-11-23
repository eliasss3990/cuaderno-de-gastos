// Rutas de sincronización: subir operaciones, bajar los cambios y conocer la cabeza del viaje. Solo las ve el dispositivo
// del viaje (con otro viaje en el camino, 404). Los números de la URL llegan como texto: se validan con un patrón.

import type { FastifyInstance } from "fastify";
import type { ServicioDeIdentidad } from "../dominio/identidad/servicioIdentidad.js";
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

export function rutasDeSincronizacion(app: FastifyInstance, identidad: ServicioDeIdentidad, sincronizacion: ServicioDeSincronizacion, ahora: () => number): void {
  const auth = exigirDispositivo(identidad);

  app.post<{ Params: { trip: string }; Body: { ops: unknown[] } }>(
    "/v1/trips/:trip/ops",
    { onRequest: auth, bodyLimit: LIMITE_DEL_LOTE_BYTES, schema: { body: SUBIR } },
    (request) => {
      const actor = delViaje(request.params.trip, request.dispositivo);
      const resultados = sincronizacion.subir(actor, request.body.ops.map(delCable));
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
}
