// Rutas de los archivos de los adjuntos: subir (PUT) y bajar (GET) el archivo y su miniatura. Las ve solo un dispositivo del
// viaje (con otro viaje en el camino, 404). El cuerpo llega como bytes crudos; el tipo se decide por los primeros bytes.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Variante } from "../dominio/adjuntos/archivos.js";
import type { ServicioDeAdjuntos } from "../dominio/adjuntos/servicioAdjuntos.js";
import type { ServicioDeIdentidad } from "../dominio/identidad/servicioIdentidad.js";
import { MAX_BYTES_PDF } from "../dominio/operaciones/validacion.js";
import type { Metricas } from "../observabilidad/metricas.js";
import { abreviarId } from "../observabilidad/registro.js";
import { delViaje, exigirDispositivo } from "./autenticacion.js";
import { ErrorHttp } from "./errores.js";
import { ESPERA_MAXIMA_DE_SUBIDA_MS, LimiteDeSubidas, SinLugarParaSubir } from "./limiteDeSubidas.js";

const UUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const PARAMETROS = {
  type: "object",
  properties: { trip: { type: "string", pattern: UUID }, id: { type: "string", pattern: UUID } },
} as const;

/** Un archivo nunca pasa del tope de los PDF; lo que pase del tope de su tipo lo rechaza el servicio. */
export const LIMITE_DEL_ARCHIVO_BYTES = MAX_BYTES_PDF;

/** Un `If-None-Match` coincide si trae la etiqueta (sola, débil o dentro de una lista) o `*`. */
export function coincideEtag(cabecera: string | undefined, etag: string): boolean {
  if (cabecera === undefined) return false;
  return cabecera.split(",").some((e) => {
    const limpia = e.trim().replace(/^W\//, "");
    return limpia === "*" || limpia === etag;
  });
}

export interface DependenciasDeAdjuntos {
  readonly identidad: ServicioDeIdentidad;
  readonly adjuntos: ServicioDeAdjuntos;
  readonly metricas: Metricas;
  /** Cuántas subidas se atienden a la vez; por defecto 2, con 8 esperando como mucho 30 s. */
  readonly limite?: LimiteDeSubidas;
}

/**
 * El hook que pide un turno de subida ANTES de leer el cuerpo y lo libera cuando la respuesta se cierra (bien, con error o
 * porque el cliente se fue). Si el cliente ya se había ido, no pide lugar: su `close` ya pasó y nadie lo liberaría.
 */
export function crearEsperarTurno(limite: LimiteDeSubidas, metricas: Metricas) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // si el cliente ya se fue antes de este punto, su `close` ya pasó: no se pide lugar (nadie lo liberaría)
    const cerrada = (): boolean => request.raw.destroyed || request.raw.socket?.destroyed === true;
    if (cerrada()) throw new ErrorHttp(400, "subida_cancelada", "el cliente se fue antes de subir");
    const control = new AbortController();
    reply.raw.once("close", () => control.abort());
    let liberar: () => void;
    try {
      liberar = await limite.pedir(ESPERA_MAXIMA_DE_SUBIDA_MS, control.signal);
    } catch (e) {
      if (!(e instanceof SinLugarParaSubir)) throw new ErrorHttp(400, "subida_cancelada", "el cliente se fue mientras esperaba");
      metricas.contar("adjuntos_sin_lugar");
      request.registro.warn("subida_sin_lugar", { motivo: e.message });
      void reply.header("retry-after", "10");
      throw new ErrorHttp(503, "servidor_ocupado", "hay muchas subidas en curso: reintentá en un momento");
    }
    if (control.signal.aborted || cerrada()) liberar();
    else reply.raw.once("close", liberar);
  };
}

export function rutasDeAdjuntos(app: FastifyInstance, dep: DependenciasDeAdjuntos): void {
  const { identidad, adjuntos, metricas } = dep;
  const auth = exigirDispositivo(identidad);
  const limite = dep.limite ?? new LimiteDeSubidas();

  const esperarTurno = crearEsperarTurno(limite, metricas);

  // el cuerpo de un archivo son bytes: se reciben tal cual (el tipo real lo decide el servicio por los primeros bytes)
  app.addContentTypeParser(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/octet-stream"], { parseAs: "buffer" }, (_request, cuerpo, hecho) => {
    hecho(null, cuerpo);
  });

  for (const [sufijo, variante] of [["", "archivo"], ["/thumb", "miniatura"]] as const) {
    const ruta = `/v1/trips/:trip/attachments/:id${sufijo}`;

    app.put<{ Params: { trip: string; id: string } }>(ruta, { onRequest: [auth, esperarTurno], bodyLimit: LIMITE_DEL_ARCHIVO_BYTES, schema: { params: PARAMETROS } }, async (request, reply) => {
      const actor = delViaje(request.params.trip, request.dispositivo);
      const contenido = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const r = await adjuntos.subir(actor.tripId, request.params.id, variante, contenido);
      metricas.contar("adjuntos_subidos", 1, { variante, repetido: r.guardado ? "no" : "si" });
      if (r.guardado) metricas.contar("adjuntos_bytes", r.bytes, { variante });
      request.registro.info("adjunto_subido", { adjunto_id: abreviarId(request.params.id), variante, bytes: r.bytes, repetido: !r.guardado });
      return reply.status(204).send();
    });

    app.get<{ Params: { trip: string; id: string } }>(ruta, { onRequest: auth, schema: { params: PARAMETROS } }, async (request, reply) => {
      const actor = delViaje(request.params.trip, request.dispositivo);
      const a = await adjuntos.bajar(actor.tripId, request.params.id, variante as Variante);
      void reply
        .header("cache-control", "private, max-age=31536000, immutable")
        .header("etag", a.etag)
        .header("x-content-type-options", "nosniff")
        // el archivo se muestra, nunca se ejecuta: sin scripts, sin recursos y en un contexto aislado
        .header("content-disposition", "inline")
        .header("content-security-policy", "sandbox; default-src 'none'");
      if (coincideEtag(request.headers["if-none-match"], a.etag)) {
        a.flujo.destroy();
        return reply.status(304).send();
      }
      return reply.header("content-type", a.mime).header("content-length", a.bytes).send(a.flujo);
    });
  }
}
