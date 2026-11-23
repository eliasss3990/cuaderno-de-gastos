// Versión mínima de la app (426) y autenticación por token de dispositivo (401), como hooks `onRequest`:
// corren antes de leer el cuerpo, así un pedido sin token nunca llega a validar su JSON.

import type { FastifyRequest, onRequestHookHandler } from "fastify";
import type { ServicioDeIdentidad } from "../dominio/identidad/servicioIdentidad.js";
import { abreviarId } from "../observabilidad/registro.js";
import { ErrorHttp } from "./errores.js";
import { compararVersiones, parsearVersion } from "./versiones.js";

/** El token de `Authorization: Bearer <token>`; `undefined` si falta o tiene otro esquema (el servicio responde 401). */
export function leerToken(request: FastifyRequest): string | undefined {
  const cabecera = request.headers.authorization;
  const m = typeof cabecera === "string" ? /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(cabecera) : null;
  return m?.[1];
}

const entero = (x: unknown): number | undefined => (typeof x === "string" && /^\d{1,15}$/.test(x) ? Number(x) : undefined);

/** Responde 426 si `X-App-Version` es menor que la mínima; una cabecera ausente o ilegible se acepta. Solo rige para `/v1/`. */
export function exigirVersion(minima: readonly number[]): onRequestHookHandler {
  return (request, _reply, hecho) => {
    if (!request.routeOptions?.url?.startsWith("/v1/")) return hecho();
    const version = parsearVersion(request.headers["x-app-version"]);
    hecho(version !== null && compararVersiones(version, minima) < 0 ? new ErrorHttp(426, "app_desactualizada", "Actualizá la app") : undefined);
  };
}

/** Autentica al dispositivo (anota lo que informa en `X-Ultimo-Seq` y `X-Pendientes`) y deja su registro con `trip_id` y `device_id`. */
export function exigirDispositivo(servicio: ServicioDeIdentidad): onRequestHookHandler {
  return (request, _reply, hecho) => {
    let error: Error | undefined;
    try {
      const visto = { ultimoSeq: entero(request.headers["x-ultimo-seq"]), pendientes: entero(request.headers["x-pendientes"]) };
      const dispositivo = servicio.autenticar(leerToken(request), visto);
      request.dispositivo = dispositivo;
      request.registro = request.registro.hijo({ trip_id: abreviarId(dispositivo.tripId), device_id: abreviarId(dispositivo.deviceId) });
    } catch (e) {
      error = e as Error;
    }
    hecho(error);
  };
}
