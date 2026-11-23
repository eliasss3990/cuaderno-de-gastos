// Repositorio de identidad sobre SQLite: dispositivos, invitaciones e intentos de unirse (puerto en dominio/identidad).

import type { Database, Statement } from "better-sqlite3";
import { ViajeCompletoError, type Dispositivo, type Invitacion, type NuevaInvitacion, type NuevoDispositivo, type RepositorioDeIdentidad } from "../../dominio/identidad/identidad.js";

/** Consultas que deben usar un índice (la prueba de migraciones comprueba su plan). */
export const CONSULTAS_IDENTIDAD = {
  dispositivoPorToken: "SELECT * FROM device WHERE token_hash = ?",
  contarActivos: "SELECT COUNT(*) AS n FROM device WHERE trip_id = ? AND revocado_en IS NULL",
  dispositivosDelViaje: "SELECT * FROM device WHERE trip_id = ? ORDER BY creado_en, device_id",
  invitacionPorCodigo: "SELECT * FROM invitation WHERE codigo_hash = ?",
  intentosFallidos: "SELECT COUNT(*) AS n FROM join_attempt WHERE ip_hash = ? AND intentado_en >= ? AND ok = 0",
  limpiarIntentos: "DELETE FROM join_attempt WHERE intentado_en < ?",
} as const;

/**
 * Las entradas numéricas deben ser enteros seguros. Sin esto, un NaN o un undefined se enlaza como NULL y SQLite
 * lo trata en silencio (por ejemplo `MAX(NULL, x)` es NULL: una revocación que no revoca).
 */
function entero(valor: unknown, nombre: string): asserts valor is number {
  // Number.isSafeInteger ya es falso para texto, BigInt, booleanos, null y undefined (no convierte el tipo)
  if (!Number.isSafeInteger(valor)) throw new RangeError(`${nombre} debe ser un entero seguro, llegó ${String(valor)}`);
}

/** Un entero seguro no negativo (seq y pendientes). */
function enteroNoNegativo(valor: unknown, nombre: string): asserts valor is number {
  entero(valor, nombre);
  if (valor < 0) throw new RangeError(`${nombre} no puede ser negativo, llegó ${valor}`);
}

/** Identificadores y huellas: texto no vacío. Un undefined o un número no deben buscar (o crear) en silencio. */
function texto(valor: unknown, nombre: string): asserts valor is string {
  if (typeof valor !== "string" || valor === "") throw new RangeError(`${nombre} debe ser un texto no vacío, llegó ${String(valor)}`);
}

interface FilaDispositivo {
  device_id: string;
  trip_id: string;
  member_id: string;
  nombre: string;
  creado_en: number;
  revocado_en: number | null;
  ultimo_visto_en: number | null;
  ultimo_seq_visto: number;
  pendientes: number;
}

interface FilaInvitacion {
  invitation_id: string;
  trip_id: string;
  reemplaza_member_id: string | null;
  creada_en: number;
  vence_en: number;
  usada_en: number | null;
  usada_por_device_id: string | null;
}

const aDispositivo = (f: FilaDispositivo): Dispositivo => ({
  deviceId: f.device_id,
  tripId: f.trip_id,
  memberId: f.member_id,
  nombre: f.nombre,
  creadoEn: f.creado_en,
  revocadoEn: f.revocado_en,
  ultimoVistoEn: f.ultimo_visto_en,
  ultimoSeqVisto: f.ultimo_seq_visto,
  pendientes: f.pendientes,
});

const aInvitacion = (f: FilaInvitacion): Invitacion => ({
  invitationId: f.invitation_id,
  tripId: f.trip_id,
  reemplazaMemberId: f.reemplaza_member_id,
  creadaEn: f.creada_en,
  venceEn: f.vence_en,
  usadaEn: f.usada_en,
  usadaPorDeviceId: f.usada_por_device_id,
});

export class IdentidadSqlite implements RepositorioDeIdentidad {
  private readonly preparadas = new Map<string, Statement>();

  constructor(private readonly db: Database) {}

  private q(sql: string): Statement {
    let s = this.preparadas.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.preparadas.set(sql, s);
    }
    return s;
  }

  transaccion<T>(fn: () => T): T {
    if (this.db.inTransaction) return fn();
    return this.db.transaction(fn).immediate();
  }

  crearDispositivo(d: NuevoDispositivo, maxActivos: number): void {
    texto(d.deviceId, "el dispositivo");
    texto(d.memberId, "el integrante"); // el viaje lo valida contarActivos, dentro de la transacción
    texto(d.nombre, "el nombre");
    texto(d.tokenHash, "la huella del token");
    entero(maxActivos, "el máximo de dispositivos activos");
    entero(d.creadoEn, "la hora de creación");
    this.transaccion(() => {
      if (this.contarActivos(d.tripId) >= maxActivos) throw new ViajeCompletoError(`el viaje ya tiene ${maxActivos} dispositivos activos`);
      this.insertarDispositivo(d);
    });
  }

  private insertarDispositivo(d: NuevoDispositivo): void {
    this.q("INSERT INTO device (device_id, trip_id, member_id, nombre, token_hash, creado_en) VALUES (?, ?, ?, ?, ?, ?)").run(d.deviceId, d.tripId, d.memberId, d.nombre, d.tokenHash, d.creadoEn);
  }

  dispositivo(deviceId: string): Dispositivo | null {
    texto(deviceId, "el dispositivo");
    const f = this.q("SELECT * FROM device WHERE device_id = ?").get(deviceId) as FilaDispositivo | undefined;
    return f === undefined ? null : aDispositivo(f);
  }

  dispositivoPorToken(tokenHash: string): Dispositivo | null {
    texto(tokenHash, "la huella del token");
    const f = this.q(CONSULTAS_IDENTIDAD.dispositivoPorToken).get(tokenHash) as FilaDispositivo | undefined;
    return f === undefined ? null : aDispositivo(f);
  }

  dispositivosDelViaje(tripId: string): Dispositivo[] {
    texto(tripId, "el viaje");
    return (this.q(CONSULTAS_IDENTIDAD.dispositivosDelViaje).all(tripId) as FilaDispositivo[]).map(aDispositivo);
  }

  contarActivos(tripId: string): number {
    texto(tripId, "el viaje");
    return (this.q(CONSULTAS_IDENTIDAD.contarActivos).get(tripId) as { n: number }).n;
  }

  revocar(deviceId: string, ahoraMs: number): boolean {
    texto(deviceId, "el dispositivo");
    entero(ahoraMs, "la hora");
    // MAX: revocar es una acción de seguridad y no debe fallar si el reloj del servidor retrocedió por debajo de la creación
    return this.q("UPDATE device SET revocado_en = MAX(?, creado_en) WHERE device_id = ? AND revocado_en IS NULL").run(ahoraMs, deviceId).changes === 1;
  }

  registrarVisto(deviceId: string, ahoraMs: number, ultimoSeq: number, pendientes: number): boolean {
    texto(deviceId, "el dispositivo");
    entero(ahoraMs, "la hora");
    enteroNoNegativo(ultimoSeq, "el último seq");
    enteroNoNegativo(pendientes, "los pendientes");
    return this.q("UPDATE device SET ultimo_visto_en = ?, ultimo_seq_visto = ?, pendientes = ? WHERE device_id = ? AND revocado_en IS NULL").run(ahoraMs, ultimoSeq, pendientes, deviceId).changes === 1;
  }

  crearInvitacion(i: NuevaInvitacion): void {
    texto(i.invitationId, "la invitación");
    texto(i.tripId, "el viaje");
    texto(i.codigoHash, "la huella del código");
    if (i.reemplazaMemberId !== null) texto(i.reemplazaMemberId, "el integrante que se reemplaza");
    entero(i.creadaEn, "la hora de creación");
    entero(i.venceEn, "la hora de vencimiento");
    this.q("INSERT INTO invitation (invitation_id, trip_id, codigo_hash, reemplaza_member_id, creada_en, vence_en) VALUES (?, ?, ?, ?, ?, ?)").run(i.invitationId, i.tripId, i.codigoHash, i.reemplazaMemberId, i.creadaEn, i.venceEn);
  }

  invitacionPorCodigo(codigoHash: string): Invitacion | null {
    texto(codigoHash, "la huella del código");
    const f = this.q(CONSULTAS_IDENTIDAD.invitacionPorCodigo).get(codigoHash) as FilaInvitacion | undefined;
    return f === undefined ? null : aInvitacion(f);
  }

  marcarUsada(invitationId: string, ahoraMs: number, deviceId: string): boolean {
    texto(invitationId, "la invitación");
    texto(deviceId, "el dispositivo");
    entero(ahoraMs, "la hora");
    // `ahoraMs >= creada_en`: con el reloj del servidor atrasado la invitación no sirve todavía (falla cerrado).
    // El dispositivo debe ser posterior a la invitación y no haber consumido otra.
    return this.q(
      "UPDATE invitation SET usada_en = ?, usada_por_device_id = ? WHERE invitation_id = ? AND usada_en IS NULL AND vence_en > ? AND creada_en <= ? AND NOT EXISTS (SELECT 1 FROM invitation WHERE usada_por_device_id = ?) AND EXISTS (SELECT 1 FROM device WHERE device_id = ? AND trip_id = invitation.trip_id AND revocado_en IS NULL AND creado_en >= invitation.creada_en AND (invitation.reemplaza_member_id IS NULL OR member_id = invitation.reemplaza_member_id))",
    ).run(ahoraMs, deviceId, invitationId, ahoraMs, ahoraMs, deviceId, deviceId).changes === 1;
  }

  registrarIntento(ipHash: string, ahoraMs: number, ok: boolean): void {
    texto(ipHash, "la huella de la IP");
    entero(ahoraMs, "la hora");
    if (typeof ok !== "boolean") throw new RangeError(`ok debe ser un booleano, llegó ${String(ok)}`);
    this.q("INSERT INTO join_attempt (ip_hash, intentado_en, ok) VALUES (?, ?, ?)").run(ipHash, ahoraMs, ok ? 1 : 0);
  }

  intentosFallidos(ipHash: string, desdeMs: number): number {
    texto(ipHash, "la huella de la IP");
    entero(desdeMs, "el límite");
    return (this.q(CONSULTAS_IDENTIDAD.intentosFallidos).get(ipHash, desdeMs) as { n: number }).n;
  }

  limpiarIntentos(antesDeMs: number): number {
    entero(antesDeMs, "el límite");
    return this.q(CONSULTAS_IDENTIDAD.limpiarIntentos).run(antesDeMs).changes;
  }
}
