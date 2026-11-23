// Almacén del estado de un viaje sobre SQLite (better-sqlite3 es síncrono, como el puerto). Cumple el mismo contrato
// que el de memoria y se prueba con las mismas pruebas. Una instancia atiende a un solo viaje (`tripId`): todas las
// consultas van acotadas a él.

import type { Database, Statement } from "better-sqlite3";
import type { Instantanea, InstantaneaEntidad } from "../../dominio/operaciones/almacenMemoria.js";
import type { Almacen, Campos, IntervaloCierre, Json, OpGuardada, OpLeida } from "../../dominio/operaciones/operaciones.js";

const ordenar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clave = (tipo: string, id: string): string => `${tipo}\u0000${id}`;

/** Consultas que deben usar un índice (la prueba de migraciones comprueba su plan). */
export const CONSULTAS = {
  adjuntosDe: "SELECT id FROM entity_field WHERE trip_id = ? AND tipo = 'attachment' AND campo = 'owner_id' AND valor = ?",
  // `INDEXED BY`: sin estadísticas SQLite prefiere recorrer la clave primaria en orden de secuencia, y eso lee todo el registro
  padreRegistrado: "SELECT padre_id FROM op INDEXED BY ix_op_entidad WHERE trip_id = ? AND entity_type = ? AND entity_id = ? AND padre_id IS NOT NULL ORDER BY server_seq LIMIT 1",
  redactarPorEntidad: "UPDATE op INDEXED BY ix_op_entidad SET payload = NULL, redactada = 1 WHERE trip_id = ? AND entity_type = ? AND entity_id = ?",
  redactarPorPadre: "UPDATE op INDEXED BY ix_op_padre SET payload = NULL, redactada = 1 WHERE trip_id = ? AND padre_id = ?",
  marcaEnUso: "SELECT 1 FROM op WHERE trip_id = ? AND hlc = ?",
  ultimaMarcaDe: "SELECT MAX(hlc) AS hlc FROM op WHERE trip_id = ? AND dispositivo = ?",
} as const;

interface FilaOp {
  op_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  hlc: string;
  payload: string | null;
  redactada: number;
  padre_id: string | null;
  server_seq: number;
}

export class AlmacenSqlite implements Almacen {
  private readonly preparadas = new Map<string, Statement>();

  constructor(
    protected readonly db: Database,
    private readonly tripId: string,
  ) {}

  private q(sql: string): Statement {
    let s = this.preparadas.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.preparadas.set(sql, s);
    }
    return s;
  }

  transaccion<T>(fn: () => T): T {
    if (this.db.inTransaction) return fn(); // ya hay una en curso: forma parte de ella
    return this.db.transaction(fn).immediate();
  }

  opConocida(opId: string): boolean {
    return this.q("SELECT 1 FROM op WHERE trip_id = ? AND op_id = ?").get(this.tripId, opId) !== undefined;
  }

  marcaEnUso(hlc: string): boolean {
    return this.q(CONSULTAS.marcaEnUso).get(this.tripId, hlc) !== undefined;
  }

  entidadExiste(tipo: string, id: string): boolean {
    return this.q("SELECT 1 FROM entity WHERE trip_id = ? AND tipo = ? AND id = ?").get(this.tripId, tipo, id) !== undefined;
  }

  entidadTerminada(tipo: string, id: string): boolean {
    return this.q("SELECT 1 FROM entity_tombstone WHERE trip_id = ? AND tipo = ? AND id = ?").get(this.tripId, tipo, id) !== undefined;
  }

  idDelViaje(): string | null {
    const fila = this.q("SELECT id FROM entity WHERE trip_id = ? AND tipo = 'trip' ORDER BY id LIMIT 1").get(this.tripId) as { id: string } | undefined;
    return fila?.id ?? null;
  }

  intervalosDeCierre(): readonly IntervaloCierre[] {
    const filas = this.q("SELECT desde_ms, hasta_ms, causa FROM trip_closed_interval WHERE trip_id = ? ORDER BY desde_ms").all(this.tripId) as { desde_ms: number; hasta_ms: number | null; causa: IntervaloCierre["causa"] }[];
    return filas.map((f) => ({ desdeMs: f.desde_ms, hastaMs: f.hasta_ms, causa: f.causa }));
  }

  abrirIntervalo(desdeMs: number, causa: IntervaloCierre["causa"]): void {
    const ultimo = this.q("SELECT desde_ms, hasta_ms FROM trip_closed_interval WHERE trip_id = ? ORDER BY desde_ms DESC LIMIT 1").get(this.tripId) as { desde_ms: number; hasta_ms: number | null } | undefined;
    if (ultimo !== undefined && (ultimo.hasta_ms === null || desdeMs < ultimo.hasta_ms)) throw new Error("el intervalo se superpone con el anterior");
    this.q("INSERT INTO trip_closed_interval (trip_id, desde_ms, hasta_ms, causa) VALUES (?, ?, NULL, ?)").run(this.tripId, desdeMs, causa);
  }

  cerrarIntervalo(hastaMs: number): void {
    const ultimo = this.q("SELECT desde_ms, hasta_ms FROM trip_closed_interval WHERE trip_id = ? ORDER BY desde_ms DESC LIMIT 1").get(this.tripId) as { desde_ms: number; hasta_ms: number | null } | undefined;
    if (ultimo === undefined || ultimo.hasta_ms !== null) throw new Error("no hay un intervalo abierto");
    if (hastaMs <= ultimo.desde_ms) throw new Error("el fin debe ser posterior al inicio");
    this.q("UPDATE trip_closed_interval SET hasta_ms = ? WHERE trip_id = ? AND desde_ms = ?").run(hastaMs, this.tripId, ultimo.desde_ms);
  }

  leerCampo(tipo: string, id: string, campo: string): Json | undefined {
    const fila = this.q("SELECT valor FROM entity_field WHERE trip_id = ? AND tipo = ? AND id = ? AND campo = ?").get(this.tripId, tipo, id, campo) as { valor: string } | undefined;
    return fila === undefined ? undefined : (JSON.parse(fila.valor) as Json);
  }

  contarEntidades(tipo: string): number {
    return (this.q("SELECT COUNT(*) AS n FROM entity WHERE trip_id = ? AND tipo = ?").get(this.tripId, tipo) as { n: number }).n;
  }

  leerReloj(tipo: string, id: string, campo: string): string | null {
    const fila = this.q("SELECT hlc FROM entity_field WHERE trip_id = ? AND tipo = ? AND id = ? AND campo = ?").get(this.tripId, tipo, id, campo) as { hlc: string } | undefined;
    return fila?.hlc ?? null;
  }

  crearEntidad(tipo: string, id: string): void {
    this.q("INSERT OR IGNORE INTO entity (trip_id, tipo, id) VALUES (?, ?, ?)").run(this.tripId, tipo, id);
  }

  escribirCampo(tipo: string, id: string, campo: string, valor: Json, hlc: string): void {
    if (!this.entidadExiste(tipo, id)) throw new Error(`la entidad ${tipo}/${id} no existe`);
    this.q(
      "INSERT INTO entity_field (trip_id, tipo, id, campo, valor, hlc) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (trip_id, tipo, id, campo) DO UPDATE SET valor = excluded.valor, hlc = excluded.hlc",
    ).run(this.tripId, tipo, id, campo, JSON.stringify(valor), hlc);
  }

  adjuntosDe(ownerId: string): string[] {
    const filas = this.q(CONSULTAS.adjuntosDe).all(this.tripId, JSON.stringify(ownerId)) as { id: string }[];
    return filas.map((f) => f.id).sort(ordenar);
  }

  terminar(tipo: string, id: string): void {
    this.q("DELETE FROM entity WHERE trip_id = ? AND tipo = ? AND id = ?").run(this.tripId, tipo, id); // sus campos caen en cascada
    this.q("INSERT OR IGNORE INTO entity_tombstone (trip_id, tipo, id) VALUES (?, ?, ?)").run(this.tripId, tipo, id);
  }

  redactarPorEntidad(tipo: string, id: string): void {
    this.q(CONSULTAS.redactarPorEntidad).run(this.tripId, tipo, id);
  }

  redactarPorPadre(padreId: string): void {
    this.q(CONSULTAS.redactarPorPadre).run(this.tripId, padreId);
  }

  padreRegistrado(tipo: string, id: string): string | null {
    const fila = this.q(CONSULTAS.padreRegistrado).get(this.tripId, tipo, id) as { padre_id: string } | undefined;
    return fila?.padre_id ?? null;
  }

  guardarOp(op: OpGuardada): number {
    const { s } = this.q("SELECT COALESCE(MAX(server_seq), 0) + 1 AS s FROM op WHERE trip_id = ?").get(this.tripId) as { s: number };
    this.q(
      "INSERT INTO op (trip_id, server_seq, op_id, entity_type, entity_id, padre_id, type, hlc, payload, redactada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(this.tripId, s, op.opId, op.entidadTipo, op.entidadId, op.padreId, op.tipo, op.hlc, op.payload === null ? null : JSON.stringify(op.payload), op.redactada ? 1 : 0);
    return s;
  }

  buscarOp(opId: string): { seq: number; hlc: string } | null {
    const fila = this.q("SELECT server_seq, hlc FROM op WHERE trip_id = ? AND op_id = ?").get(this.tripId, opId) as { server_seq: number; hlc: string } | undefined;
    return fila === undefined ? null : { seq: fila.server_seq, hlc: fila.hlc };
  }

  leerOps(despuesDe: number, limite: number): readonly OpLeida[] {
    const filas = this.q("SELECT op_id, type, entity_type, entity_id, hlc, payload, redactada, padre_id, server_seq FROM op WHERE trip_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?").all(this.tripId, despuesDe, limite) as FilaOp[];
    return filas.map((f) => ({
      opId: f.op_id,
      tipo: f.type,
      entidadTipo: f.entity_type,
      entidadId: f.entity_id,
      hlc: f.hlc,
      payload: f.payload === null ? null : (JSON.parse(f.payload) as Campos),
      redactada: f.redactada === 1,
      padreId: f.padre_id,
      seq: f.server_seq,
    }));
  }

  seqMaximo(): number {
    return (this.q("SELECT COALESCE(MAX(server_seq), 0) AS s FROM op WHERE trip_id = ?").get(this.tripId) as { s: number }).s;
  }

  ultimaMarcaDe(dispositivo: string): string | null {
    const fila = this.q(CONSULTAS.ultimaMarcaDe).get(this.tripId, dispositivo) as { hlc: string | null };
    return fila.hlc;
  }

  /** Vista ordenada del estado, con el mismo formato que la del almacén en memoria (para compararlos). */
  instantanea(): Instantanea {
    const entidades = new Map<string, { tipo: string; id: string; campos: { [c: string]: Json }; relojes: { [c: string]: string } }>();
    for (const e of this.q("SELECT tipo, id FROM entity WHERE trip_id = ?").all(this.tripId) as { tipo: string; id: string }[]) {
      entidades.set(clave(e.tipo, e.id), { tipo: e.tipo, id: e.id, campos: {}, relojes: {} });
    }
    for (const f of this.q("SELECT tipo, id, campo, valor, hlc FROM entity_field WHERE trip_id = ?").all(this.tripId) as { tipo: string; id: string; campo: string; valor: string; hlc: string }[]) {
      const e = entidades.get(clave(f.tipo, f.id));
      if (e === undefined) continue;
      e.campos[f.campo] = JSON.parse(f.valor) as Json;
      e.relojes[f.campo] = f.hlc;
    }
    const ordenadoPorClave = <T extends { tipo: string; id: string }>(x: T, y: T): number => ordenar(clave(x.tipo, x.id), clave(y.tipo, y.id));
    const llaves = (o: { [c: string]: unknown }): string[] => Object.keys(o).sort(ordenar);
    const entidadesOrdenadas: InstantaneaEntidad[] = [...entidades.values()].sort(ordenadoPorClave).map((e) => ({
      tipo: e.tipo,
      id: e.id,
      campos: Object.fromEntries(llaves(e.campos).map((k) => [k, e.campos[k] as Json])),
      relojes: Object.fromEntries(llaves(e.relojes).map((k) => [k, e.relojes[k] as string])),
    }));
    const lapidas = (this.q("SELECT tipo, id FROM entity_tombstone WHERE trip_id = ?").all(this.tripId) as { tipo: string; id: string }[]).sort(ordenadoPorClave);
    const ops = (this.q("SELECT op_id, type, entity_type, entity_id, hlc, payload, redactada, padre_id, server_seq FROM op WHERE trip_id = ?").all(this.tripId) as FilaOp[])
      .sort((x, y) => ordenar(x.op_id, y.op_id))
      .map((f) => ({
        opId: f.op_id,
        tipo: f.type,
        entidadTipo: f.entity_type,
        entidadId: f.entity_id,
        hlc: f.hlc,
        payload: f.payload === null ? null : (JSON.parse(f.payload) as Campos),
        redactada: f.redactada === 1,
        padreId: f.padre_id,
      }));
    return { entidades: entidadesOrdenadas, lapidas, ops };
  }

  /** Números de secuencia de las operaciones guardadas (para comprobar que no hay huecos). */
  secuencias(): number[] {
    return (this.q("SELECT server_seq FROM op WHERE trip_id = ? ORDER BY server_seq").all(this.tripId) as { server_seq: number }[]).map((f) => f.server_seq);
  }
}
