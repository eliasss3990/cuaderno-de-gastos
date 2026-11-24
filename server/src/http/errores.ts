// Errores de la API: cuerpo `{"error":{"codigo","mensaje"}}` y el estado HTTP de cada código.

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ErrorDeAdjunto, type CodigoDeErrorDeAdjunto } from "../dominio/adjuntos/servicioAdjuntos.js";
import { ErrorDeServicio, type CodigoDeError } from "../dominio/identidad/servicioIdentidad.js";
import type { Registro } from "../observabilidad/registro.js";

/** Un error con su estado y código ya decididos (por ejemplo `426 app_desactualizada`). */
export class ErrorHttp extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorHttp";
  }
}

const ESTADO_DE_SERVICIO: Record<CodigoDeError, number> = {
  formato_invalido: 400,
  no_autorizado: 401,
  dispositivo_revocado: 401,
  solo_organizador: 403,
  no_existe: 404,
  codigo_invalido: 400,
  viaje_completo: 409,
  demasiados_intentos: 429,
};

const ESTADO_DE_ADJUNTO: Record<CodigoDeErrorDeAdjunto, number> = {
  formato_invalido: 400,
  no_existe: 404,
  no_subido: 404,
  adjunto_no_registrado: 409,
  adjunto_demasiado_grande: 413,
  tipo_no_permitido: 415,
  hash_no_coincide: 422,
};

export const cuerpoDeError = (codigo: string, mensaje: string) => ({ error: { codigo, mensaje } });

/** El primer error de validación como `campo: motivo`, sin valores del pedido. */
function motivoDeValidacion(error: FastifyError): string {
  const v = error.validation?.[0];
  if (v === undefined) return "el pedido no es válido";
  const campo = v.instancePath.replace(/^\//, "").replaceAll("/", ".") || "cuerpo";
  return `${campo}: ${v.message ?? "no es válido"}`;
}

/** Traduce cualquier error a su respuesta; lo inesperado sale como `500 error_interno` sin detalles y queda en el log. */
export function crearManejadorDeErrores(raiz: Registro) {
  return (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void => {
    let estado = 500;
    let codigo = "error_interno";
    let mensaje = "error interno del servidor";
    const fastify = error as FastifyError;
    if (error instanceof ErrorDeServicio) {
      estado = ESTADO_DE_SERVICIO[error.codigo];
      codigo = error.codigo;
      mensaje = error.message;
    } else if (error instanceof ErrorDeAdjunto) {
      estado = ESTADO_DE_ADJUNTO[error.codigo];
      codigo = error.codigo;
      mensaje = error.message;
    } else if (fastify.code === "FST_ERR_CTP_BODY_TOO_LARGE" && request.routeOptions?.url?.includes("/attachments/")) {
      ({ estado, codigo, mensaje } = { estado: 413, codigo: "adjunto_demasiado_grande", mensaje: "el archivo es demasiado grande" });
    } else if (fastify.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" && request.routeOptions?.url?.includes("/attachments/")) {
      ({ estado, codigo, mensaje } = { estado: 415, codigo: "tipo_no_permitido", mensaje: "el tipo del archivo no está permitido" });
    } else if (error instanceof ErrorHttp) {
      ({ estado, codigo } = error);
      mensaje = error.message;
    } else if (typeof fastify.statusCode === "number" && fastify.statusCode >= 400 && fastify.statusCode < 500) {
      estado = 400;
      codigo = "formato_invalido";
      mensaje = motivoDeValidacion(fastify);
    } else {
      (request.registro ?? raiz).error("error_interno", { err: error });
    }
    request.codigoDeError = codigo;
    void reply.status(estado).send(cuerpoDeError(codigo, mensaje));
  };
}

export function manejarNoEncontrado(request: FastifyRequest, reply: FastifyReply): void {
  request.codigoDeError = "no_existe";
  void reply.status(404).send(cuerpoDeError("no_existe", "no existe"));
}
