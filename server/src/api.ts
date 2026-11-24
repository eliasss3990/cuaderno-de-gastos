// La API HTTP del servidor: arma Fastify con sus hooks y rutas. No lee el entorno ni abre la base: recibe el servicio, el
// registro y las métricas ya armados (el arranque real los cablea).

import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServicioDeIdentidad } from "./dominio/identidad/servicioIdentidad.js";
import type { CanalEnVivo } from "./dominio/operaciones/canalEnVivo.js";
import type { ServicioDeSincronizacion } from "./dominio/operaciones/sincronizacion.js";
import type { Metricas } from "./observabilidad/metricas.js";
import type { Registro } from "./observabilidad/registro.js";
import { exigirVersion } from "./http/autenticacion.js";
import { crearManejadorDeErrores, manejarNoEncontrado } from "./http/errores.js";
import { crearRegistroDePedidos, instalarPedidos } from "./http/pedidos.js";
import { rutasDeIdentidad } from "./http/rutasIdentidad.js";
import { rutasDeSincronizacion } from "./http/rutasSincronizacion.js";
import { parsearVersion } from "./http/versiones.js";

export interface DependenciasApi {
  readonly servicio: ServicioDeIdentidad;
  readonly sincronizacion: ServicioDeSincronizacion;
  /** El mismo canal que usa `sincronizacion` para avisar; la API lo cierra al apagarse. */
  readonly canal: CanalEnVivo;
  /** Cada cuántos milisegundos se escribe un latido en el canal en vivo; por defecto 20 s. */
  readonly latidoMs?: number;
  /** Reloj del servidor en milisegundos (la hora que se informa a las apps); por defecto `Date.now`. */
  readonly ahora?: () => number;
  readonly registro: Registro;
  readonly metricas: Metricas;
  /** `APP_MIN_VERSION`: por debajo de esta versión de la app se responde 426. Sin valor, no se exige ninguna. */
  readonly versionMinima?: string;
  /** Reloj monotónico en milisegundos para medir los pedidos; por defecto `performance.now`. */
  readonly reloj?: () => number;
}

export function construirApi(dep: DependenciasApi): FastifyInstance {
  const minima = parsearVersion(dep.versionMinima ?? "0.0.0");
  if (minima === null) throw new RangeError(`APP_MIN_VERSION inválida: "${String(dep.versionMinima)}"`);

  const manejarError = crearManejadorDeErrores(dep.registro);
  const pedidos = crearRegistroDePedidos(dep.registro, dep.metricas, dep.reloj ?? (() => performance.now()));
  const app = Fastify({
    logger: false, // los pedidos se registran por plantilla de ruta (http/pedidos.ts), no con el registro de Fastify
    genReqId: () => randomUUID(),
    bodyLimit: 16 * 1024, // las rutas que reciben más (operaciones, adjuntos) lo suben
    // los errores del enrutador (una URL mal codificada o con un parámetro larguísimo) salen antes de los hooks: se completan acá
    frameworkErrors: (error, request, reply) => {
      pedidos.iniciar(request);
      void reply.header("cache-control", "private, no-store");
      manejarError(error, request, reply);
      pedidos.terminar(request, reply.statusCode);
    },
    // sin esto Fastify convierte tipos y borra los campos de más en silencio
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
  });

  instalarPedidos(app, pedidos);
  app.addHook("onRequest", exigirVersion(minima));
  app.addHook("onSend", (_request, reply, carga, hecho) => {
    if (!reply.hasHeader("cache-control")) void reply.header("cache-control", "private, no-store");
    hecho(null, carga);
  });
  app.setErrorHandler(manejarError);
  app.setNotFoundHandler(manejarNoEncontrado);

  app.get("/healthz", () => ({ estado: "ok" }));
  rutasDeIdentidad(app, dep.servicio, dep.canal);
  // al apagar, los canales abiertos se cierran antes de esperar a que terminen los pedidos (si no, el cierre aguardaría el plazo entero)
  app.addHook("preClose", () => {
    dep.canal.cerrarTodo();
  });
  rutasDeSincronizacion(app, { identidad: dep.servicio, sincronizacion: dep.sincronizacion, canal: dep.canal, metricas: dep.metricas, ahora: dep.ahora ?? Date.now, ...(dep.latidoMs === undefined ? {} : { latidoMs: dep.latidoMs }) });
  return app;
}
