// Registro y métricas de cada pedido, por plantilla de ruta (nunca la URL cruda: puede traer parámetros con datos).

import { isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Metricas } from "../observabilidad/metricas.js";
import { abreviarId, type Registro } from "../observabilidad/registro.js";

/**
 * La IP del cliente: `X-Real-IP` (nginx la pone desde Cloudflare; el servicio solo es alcanzable por nginx) si es una IP;
 * si falta o no lo es (una lista `a, b`, basura), la del socket.
 */
export function ipDelPedido(request: FastifyRequest): string {
  const cabecera = request.headers["x-real-ip"];
  const ip = typeof cabecera === "string" ? cabecera.trim() : "";
  return isIP(ip) === 0 ? request.ip : ip;
}

export const rutaDelPedido = (request: FastifyRequest): string => request.routeOptions?.url || "sin_ruta";

export interface RegistroDePedidos {
  /** Empieza a medir el pedido y le da su registro con `req_id`. */
  iniciar(request: FastifyRequest): void;
  /** Escribe el evento `pedido` y las métricas con el estado con el que se respondió. */
  terminar(request: FastifyRequest, estado: number): void;
}

export function crearRegistroDePedidos(raiz: Registro, metricas: Metricas, reloj: () => number): RegistroDePedidos {
  return {
    iniciar(request) {
      request.inicio = reloj();
      request.registro = raiz.hijo({ req_id: abreviarId(request.id) });
    },
    terminar(request, estado) {
      const ruta = rutaDelPedido(request);
      const ms = Math.round((reloj() - request.inicio) * 10) / 10;
      const campos = { metodo: request.method, ruta, estado, ms, ...(request.codigoDeError === null ? {} : { error: request.codigoDeError }) };
      // la salud la consulta Docker cada 30 s: va a debug
      if (ruta === "/healthz") request.registro.debug("pedido", campos);
      else if (estado >= 500) request.registro.error("pedido", campos);
      else request.registro.info("pedido", campos);
      metricas.contar("http_pedidos", 1, { metodo: request.method, ruta, estado: String(estado) });
      metricas.medir("http_pedido_ms", ms, { metodo: request.method, ruta });
    },
  };
}

export function instalarPedidos(app: FastifyInstance, pedidos: RegistroDePedidos): void {
  app.decorateRequest("registro", null as unknown as Registro);
  app.decorateRequest("dispositivo", null);
  app.decorateRequest("inicio", 0);
  app.decorateRequest("codigoDeError", null);

  app.addHook("onRequest", (request, _reply, hecho) => {
    pedidos.iniciar(request);
    hecho();
  });
  app.addHook("onResponse", (request, reply, hecho) => {
    pedidos.terminar(request, reply.statusCode);
    hecho();
  });
}
