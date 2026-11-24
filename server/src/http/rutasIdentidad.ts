// Rutas de identidad: crear un viaje, unirse con un código, invitar y revocar. Los esquemas son estrictos:
// un campo de más o de otro tipo es 400 (la validación no convierte tipos ni borra campos).

import type { FastifyInstance } from "fastify";
import type { ServicioDeIdentidad } from "../dominio/identidad/servicioIdentidad.js";
import type { CanalEnVivo } from "../dominio/operaciones/canalEnVivo.js";
import { delViaje, exigirDispositivo } from "./autenticacion.js";
import { ipDelPedido } from "./pedidos.js";

const texto = { type: "string" } as const;
const textoONulo = { type: ["string", "null"] } as const;

const CREAR_VIAJE = {
  type: "object",
  additionalProperties: false,
  required: ["nombre", "zona_horaria", "monedas", "nombre_dispositivo", "apodo", "color", "emoji"],
  properties: {
    nombre: texto,
    zona_horaria: texto,
    fecha_inicio: textoONulo,
    fecha_fin: textoONulo,
    monedas: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["codigo", "decimales", "simbolo"], properties: { codigo: texto, decimales: { type: "integer" }, simbolo: texto } },
    },
    nombre_dispositivo: texto,
    apodo: texto,
    color: texto,
    emoji: texto,
  },
} as const;

// `codigo` acepta cualquier tipo a propósito: lo que no sea un código válido lo juzga el servicio y cuenta como intento fallido.
const UNIRSE = {
  type: "object",
  additionalProperties: false,
  required: ["codigo", "nombre_dispositivo"],
  properties: { codigo: {}, nombre_dispositivo: texto, apodo: texto, color: texto, emoji: texto },
} as const;

const INVITAR = { type: "object", additionalProperties: false, properties: { reemplaza_member_id: textoONulo } } as const;

interface CuerpoCrearViaje {
  nombre: string;
  zona_horaria: string;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  monedas: { codigo: string; decimales: number; simbolo: string }[];
  nombre_dispositivo: string;
  apodo: string;
  color: string;
  emoji: string;
}
interface CuerpoUnirse {
  codigo: unknown;
  nombre_dispositivo: string;
  apodo?: string;
  color?: string;
  emoji?: string;
}

export function rutasDeIdentidad(app: FastifyInstance, servicio: ServicioDeIdentidad, canal?: CanalEnVivo): void {
  app.post<{ Body: CuerpoCrearViaje }>("/v1/trips", { schema: { body: CREAR_VIAJE } }, (request, reply) => {
    const b = request.body;
    const alta = servicio.crearViaje({
      nombre: b.nombre,
      zonaHoraria: b.zona_horaria,
      ...(b.fecha_inicio === undefined ? {} : { fechaInicio: b.fecha_inicio }),
      ...(b.fecha_fin === undefined ? {} : { fechaFin: b.fecha_fin }),
      monedas: b.monedas,
      nombreDispositivo: b.nombre_dispositivo,
      apodo: b.apodo,
      color: b.color,
      emoji: b.emoji,
    });
    return reply.status(201).send({ trip_id: alta.tripId, device_id: alta.deviceId, member_id: alta.memberId, token: alta.token });
  });

  app.post<{ Body: CuerpoUnirse }>("/v1/join", { schema: { body: UNIRSE } }, (request, reply) => {
    const b = request.body;
    const alta = servicio.unirse({
      codigo: b.codigo,
      ip: ipDelPedido(request),
      nombreDispositivo: b.nombre_dispositivo,
      ...(b.apodo === undefined ? {} : { apodo: b.apodo }),
      ...(b.color === undefined ? {} : { color: b.color }),
      ...(b.emoji === undefined ? {} : { emoji: b.emoji }),
    });
    return reply.status(201).send({ trip_id: alta.tripId, device_id: alta.deviceId, member_id: alta.memberId, token: alta.token });
  });

  // el cliente manda `{}` si no reemplaza a nadie
  app.post<{ Params: { trip: string }; Body: { reemplaza_member_id?: string | null } }>(
    "/v1/trips/:trip/invitations",
    { onRequest: exigirDispositivo(servicio), schema: { body: INVITAR } },
    (request, reply) => {
      const actor = delViaje(request.params.trip, request.dispositivo);
      const invitacion = servicio.invitar(actor, request.body.reemplaza_member_id ?? null);
      return reply.status(201).send({ codigo: invitacion.codigo, vence_en: invitacion.venceEn });
    },
  );

  app.get<{ Params: { trip: string } }>("/v1/trips/:trip/familia", { onRequest: exigirDispositivo(servicio) }, (request) => {
    const f = servicio.familia(delViaje(request.params.trip, request.dispositivo));
    return {
      dispositivos: f.dispositivos.map((d) => ({
        device_id: d.deviceId,
        member_id: d.memberId,
        nombre: d.nombre,
        ultimo_visto_en: d.ultimoVistoEn,
        ultimo_seq_visto: d.ultimoSeqVisto,
        pendientes: d.pendientes,
        revocado_en: d.revocadoEn,
      })),
      head_seq: f.cabeza,
      ahora: f.ahora,
    };
  });

  app.post<{ Params: { trip: string; device: string } }>(
    "/v1/trips/:trip/devices/:device/revoke",
    { onRequest: exigirDispositivo(servicio) },
    (request, reply) => {
      const actor = delViaje(request.params.trip, request.dispositivo);
      servicio.revocar(actor, request.params.device);
      // un dispositivo revocado no sigue recibiendo avisos del viaje
      canal?.expulsar(actor.tripId, request.params.device);
      return reply.status(204).send();
    },
  );
}
