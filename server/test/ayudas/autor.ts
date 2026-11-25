// Autor de prueba de las operaciones: quién las envía y cuándo las aceptó el servidor.
import type { Remitente } from "../../src/dominio/operaciones/ingesta.js";
import type { Autor } from "../../src/dominio/operaciones/operaciones.js";

export const REMITENTE: Remitente = { deviceId: "d-prueba", memberId: "m-prueba" };
export const AUTOR: Autor = { ...REMITENTE, aceptadaEn: 0 };

/** Lo que el servidor agrega al guardar una operación (para armar `OpGuardada` a mano). */
export const SOBRE_GUARDADO = { schemaVersion: 1, deviceId: "d-prueba", memberId: "m-prueba", aceptadaEn: 0 } as const;

/** Remitente con el dispositivo dado (la recepción exige que coincida con el de la marca). */
export const remitenteDe = (deviceId: string): Remitente => ({ deviceId, memberId: `m-de-${deviceId}` });
