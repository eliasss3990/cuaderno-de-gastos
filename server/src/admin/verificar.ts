// Verificación de una base (la viva o un respaldo): integridad de SQLite y, viaje por viaje, que el estado guardado sea
// el que resulta de reaplicar su registro de operaciones. Las operaciones redactadas no se reaplican (su efecto es
// borrar): se comprueba que su entidad tenga lápida. Los intervalos de cierre no se comparan (dependen de la hora).

import Database, { type Database as Base } from "better-sqlite3";
import { VERSION_ACTUAL } from "../almacen/base/migraciones.js";
import { AlmacenSqlite } from "../almacen/operaciones/almacenSqlite.js";
import { AlmacenMemoria } from "../dominio/operaciones/almacenMemoria.js";
import { MotorOperaciones, type Campos } from "../dominio/operaciones/operaciones.js";
import { validarOperacion } from "../dominio/operaciones/validacion.js";

/** Cuántos problemas de cada viaje se detallan (el resto solo se cuenta). */
const MAX_DETALLES = 10;

interface FilaOp {
  op_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  hlc: string;
  payload: string | null;
  redactada: number;
  schema_version: number;
  device_id: string;
  member_id: string;
  aceptada_en: number;
}

const clave = (tipo: string, id: string): string => `${tipo}/${id}`;

/** Devuelve los problemas encontrados (vacío si está todo bien). Nunca muestra valores de los campos, solo dónde difieren. */
export function verificarBase(db: Base): string[] {
  const integridad = (db.pragma("integrity_check") as { integrity_check: string }[]).map((f) => f.integrity_check);
  if (integridad.length !== 1 || integridad[0] !== "ok") return integridad.map((l) => `integridad: ${l}`);
  const viajes = (db.prepare("SELECT trip_id FROM op UNION SELECT trip_id FROM entity UNION SELECT trip_id FROM entity_tombstone ORDER BY 1").all() as { trip_id: string }[]).map((f) => f.trip_id);
  // cada viaje en una sola lectura: el servidor puede estar escribiendo mientras se verifica la base viva
  return viajes.flatMap((tripId) => db.transaction(() => verificarViaje(db, tripId)).deferred());
}

function verificarViaje(db: Base, tripId: string): string[] {
  const problemas: string[] = [];
  const memoria = new AlmacenMemoria();
  const motor = new MotorOperaciones(memoria);
  const lapidasEsperadas = new Set<string>();
  const ops = db
    .prepare("SELECT op_id, type, entity_type, entity_id, hlc, payload, redactada, schema_version, device_id, member_id, aceptada_en FROM op WHERE trip_id = ? ORDER BY server_seq")
    .all(tripId) as FilaOp[];
  for (const o of ops) {
    if (o.redactada === 1) {
      lapidasEsperadas.add(clave(o.entity_type, o.entity_id));
      continue;
    }
    const op = { opId: o.op_id, tipo: o.type, entidadTipo: o.entity_type, entidadId: o.entity_id, hlc: o.hlc, payload: JSON.parse(o.payload ?? "null") as Campos, schemaVersion: o.schema_version };
    // el motor no valida los campos (lo hace la ingesta): una operación guardada debe seguir siendo válida
    const v = validarOperacion(op);
    if (!v.ok) {
      problemas.push(`viaje ${tripId}: la operación ${o.op_id} (${o.type}) no es válida (${v.campo})`);
      continue;
    }
    const r = motor.aplicar(op, { deviceId: o.device_id, memberId: o.member_id, aceptadaEn: o.aceptada_en });
    if (r.estado !== "accepted") problemas.push(`viaje ${tripId}: la operación ${o.op_id} (${o.type}) no se puede reaplicar (${r.estado === "rejected" ? r.razon : r.estado})`);
  }
  const reconstruido = memoria.instantanea();
  const guardado = new AlmacenSqlite(db, tripId).instantanea();
  for (const l of reconstruido.lapidas) lapidasEsperadas.add(clave(l.tipo, l.id));
  const lapidasGuardadas = new Set(guardado.lapidas.map((l) => clave(l.tipo, l.id)));
  for (const l of lapidasEsperadas) if (!lapidasGuardadas.has(l)) problemas.push(`viaje ${tripId}: falta la lápida de ${l}`);
  for (const l of lapidasGuardadas) if (!lapidasEsperadas.has(l)) problemas.push(`viaje ${tripId}: lápida sin operación que la explique: ${l}`);

  const esperadas = new Map(reconstruido.entidades.map((e) => [clave(e.tipo, e.id), e]));
  const guardadas = new Map(guardado.entidades.map((e) => [clave(e.tipo, e.id), e]));
  for (const [k, e] of esperadas) {
    const g = guardadas.get(k);
    if (g === undefined) {
      problemas.push(`viaje ${tripId}: falta la entidad ${k}`);
      continue;
    }
    const campos = new Set([...Object.keys(e.campos), ...Object.keys(g.campos)]);
    for (const c of campos) {
      if (JSON.stringify(e.campos[c]) !== JSON.stringify(g.campos[c]) || e.relojes[c] !== g.relojes[c]) problemas.push(`viaje ${tripId}: el campo ${c} de ${k} no coincide con el registro`);
    }
  }
  for (const k of guardadas.keys()) if (!esperadas.has(k)) problemas.push(`viaje ${tripId}: entidad sin operaciones que la expliquen: ${k}`);
  if (problemas.length <= MAX_DETALLES) return problemas;
  return [...problemas.slice(0, MAX_DETALLES), `viaje ${tripId}: y ${problemas.length - MAX_DETALLES} problemas más`];
}

/**
 * Verifica un archivo de respaldo abriéndolo en solo lectura (no lo migra ni lo modifica). Con `aceptarAnteriores`, uno
 * de una versión de esquema anterior se acepta con solo la integridad de SQLite (lo migra el servidor al arrancar): la
 * reconstrucción exige la versión actual.
 */
export function verificarRespaldo(archivo: string, aceptarAnteriores = false): string[] {
  let db: Base;
  try {
    db = new Database(archivo, { readonly: true, fileMustExist: true });
  } catch (e) {
    return [`no se puede abrir el respaldo (${archivo}): ${(e as Error).message}`];
  }
  try {
    const version = (db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migration").get() as { v: number }).v;
    if (version === VERSION_ACTUAL) return verificarBase(db);
    if (!aceptarAnteriores || version > VERSION_ACTUAL || version < 1) return [`el respaldo está en la versión ${version} de esquema y este código espera la ${VERSION_ACTUAL}`];
    const integridad = (db.pragma("integrity_check") as { integrity_check: string }[]).map((f) => f.integrity_check);
    return integridad.length === 1 && integridad[0] === "ok" ? [] : integridad.map((l) => `integridad: ${l}`);
  } catch (e) {
    return [`el respaldo no es una base del servidor: ${(e as Error).message}`];
  } finally {
    db.close();
  }
}
