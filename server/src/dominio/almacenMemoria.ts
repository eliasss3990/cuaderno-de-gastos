// Almacén en memoria del estado del viaje: sirve a las pruebas y como referencia de lo que debe cumplir
// cualquier otro almacén (por ejemplo el de SQLite). `instantanea` da una vista ordenada para comparar.

import type { Almacen, Campos, Json, OpGuardada } from "./operaciones.js";

interface Fila {
  readonly campos: Map<string, Json>;
  readonly relojes: Map<string, string>;
}

interface Entidad {
  readonly tipo: string;
  readonly id: string;
  readonly fila: Fila;
}

export interface InstantaneaEntidad {
  readonly tipo: string;
  readonly id: string;
  readonly campos: { readonly [campo: string]: Json };
  readonly relojes: { readonly [campo: string]: string };
}

export interface Instantanea {
  readonly entidades: readonly InstantaneaEntidad[];
  readonly lapidas: readonly { readonly tipo: string; readonly id: string }[];
  readonly ops: readonly OpGuardada[];
}

type Guardada = OpGuardada & { readonly seq: number };

const clave = (tipo: string, id: string): string => `${tipo}\u0000${id}`;
const ordenar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function ordenado<T>(m: ReadonlyMap<string, T>): { [campo: string]: T } {
  const salida: { [campo: string]: T } = {};
  for (const k of [...m.keys()].sort(ordenar)) salida[k] = m.get(k) as T;
  return salida;
}

export class AlmacenMemoria implements Almacen {
  private readonly entidades = new Map<string, Entidad>();
  private readonly lapidas = new Map<string, { tipo: string; id: string }>();
  private readonly ops = new Map<string, Guardada>();
  private readonly marcas = new Set<string>();
  private seq = 0;
  /** Pasos para deshacer lo hecho dentro de la transacción en curso (null si no hay ninguna). */
  private diario: (() => void)[] | null = null;

  transaccion<T>(fn: () => T): T {
    if (this.diario !== null) return fn(); // ya hay una en curso: forma parte de ella
    const diario: (() => void)[] = [];
    this.diario = diario;
    try {
      const resultado = fn();
      this.diario = null;
      return resultado;
    } catch (error) {
      this.diario = null;
      for (let i = diario.length - 1; i >= 0; i--) (diario[i] as () => void)();
      throw error;
    }
  }

  private deshacer(paso: () => void): void {
    this.diario?.push(paso);
  }

  opConocida(opId: string): boolean {
    return this.ops.has(opId);
  }

  marcaEnUso(hlc: string): boolean {
    return this.marcas.has(hlc);
  }

  entidadExiste(tipo: string, id: string): boolean {
    return this.entidades.has(clave(tipo, id));
  }

  entidadTerminada(tipo: string, id: string): boolean {
    return this.lapidas.has(clave(tipo, id));
  }

  leerCampo(tipo: string, id: string, campo: string): Json | undefined {
    return this.entidades.get(clave(tipo, id))?.fila.campos.get(campo);
  }

  contarEntidades(tipo: string): number {
    let n = 0;
    for (const e of this.entidades.values()) if (e.tipo === tipo) n += 1;
    return n;
  }

  leerReloj(tipo: string, id: string, campo: string): string | null {
    return this.entidades.get(clave(tipo, id))?.fila.relojes.get(campo) ?? null;
  }

  crearEntidad(tipo: string, id: string): void {
    const k = clave(tipo, id);
    if (this.entidades.has(k)) return;
    this.entidades.set(k, { tipo, id, fila: { campos: new Map(), relojes: new Map() } });
    this.deshacer(() => this.entidades.delete(k));
  }

  escribirCampo(tipo: string, id: string, campo: string, valor: Json, hlc: string): void {
    const e = this.entidades.get(clave(tipo, id));
    if (e === undefined) throw new Error(`la entidad ${tipo}/${id} no existe`);
    const habia = e.fila.campos.has(campo);
    const valorAntes = e.fila.campos.get(campo);
    const relojAntes = e.fila.relojes.get(campo);
    e.fila.campos.set(campo, copia(valor));
    e.fila.relojes.set(campo, hlc);
    this.deshacer(() => {
      if (habia) {
        e.fila.campos.set(campo, valorAntes as Json);
        e.fila.relojes.set(campo, relojAntes as string);
      } else {
        e.fila.campos.delete(campo);
        e.fila.relojes.delete(campo);
      }
    });
  }

  adjuntosDe(ownerId: string): string[] {
    const ids: string[] = [];
    for (const e of this.entidades.values()) {
      if (e.tipo === "attachment" && e.fila.campos.get("owner_id") === ownerId) ids.push(e.id);
    }
    return ids.sort(ordenar);
  }

  terminar(tipo: string, id: string): void {
    const k = clave(tipo, id);
    const antes = this.entidades.get(k);
    const habiaLapida = this.lapidas.has(k);
    this.entidades.delete(k);
    this.lapidas.set(k, { tipo, id });
    this.deshacer(() => {
      if (antes !== undefined) this.entidades.set(k, antes);
      if (!habiaLapida) this.lapidas.delete(k);
    });
  }

  private redactar(coincide: (op: Guardada) => boolean): void {
    const cambiadas: [string, Guardada][] = [];
    for (const [k, op] of this.ops) {
      if (!coincide(op)) continue;
      cambiadas.push([k, op]);
      this.ops.set(k, { ...op, payload: null, redactada: true });
    }
    this.deshacer(() => {
      for (const [k, op] of cambiadas) this.ops.set(k, op);
    });
  }

  redactarPorEntidad(tipo: string, id: string): void {
    this.redactar((op) => op.entidadTipo === tipo && op.entidadId === id);
  }

  redactarPorPadre(padreId: string): void {
    this.redactar((op) => op.padreId === padreId);
  }

  padreRegistrado(tipo: string, id: string): string | null {
    for (const op of this.ops.values()) {
      if (op.entidadTipo === tipo && op.entidadId === id && op.padreId !== null) return op.padreId;
    }
    return null;
  }

  guardarOp(op: OpGuardada): number {
    this.seq += 1;
    const numero = this.seq;
    this.ops.set(op.opId, { ...op, payload: op.payload === null ? null : copia(op.payload), seq: numero });
    this.marcas.add(op.hlc);
    this.deshacer(() => {
      this.ops.delete(op.opId);
      this.marcas.delete(op.hlc);
      this.seq = numero - 1;
    });
    return numero;
  }

  /** Vista ordenada del estado: sin números de secuencia, para comparar estados entre órdenes de llegada. */
  instantanea(): Instantanea {
    const entidades = [...this.entidades.values()]
      .sort((x, y) => ordenar(clave(x.tipo, x.id), clave(y.tipo, y.id)))
      .map((e) => ({ tipo: e.tipo, id: e.id, campos: ordenado(e.fila.campos), relojes: ordenado(e.fila.relojes) }));
    const lapidas = [...this.lapidas.values()].sort((x, y) => ordenar(clave(x.tipo, x.id), clave(y.tipo, y.id)));
    const ops = [...this.ops.values()]
      .sort((x, y) => ordenar(x.opId, y.opId))
      .map(({ seq: _seq, ...resto }) => ({ ...resto, payload: resto.payload === null ? null : (copia(resto.payload) as Campos) }));
    return copia({ entidades, lapidas, ops });
  }

  /** Números de secuencia por operación guardada (para comprobar que no hay huecos). */
  secuencias(): number[] {
    return [...this.ops.values()].map((o) => o.seq).sort((x, y) => x - y);
  }
}
