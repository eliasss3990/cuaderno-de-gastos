// Aplicar una operación al estado del viaje. Cada campo de una entidad es un registro de "gana el último"
// ordenado por el reloj híbrido: una edición se aplica solo si su marca es mayor que la guardada para ese
// campo. El resultado no depende del orden de llegada de las ediciones ni de los duplicados.
// El motor decide y se apoya en un almacén (puerto): en memoria para las pruebas, en SQLite en producción.
// No valida formatos ni límites de negocio (eso va antes): solo lo estructural para no corromper el estado.

import { parsearHlc } from "../base/reloj.js";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [clave: string]: Json };
export type Campos = { readonly [campo: string]: Json };

export interface Operacion {
  readonly opId: string;
  readonly tipo: string;
  readonly entidadTipo: string;
  readonly entidadId: string;
  readonly hlc: string;
  readonly payload: Campos;
  /** Versión del formato de la operación (la del cable `schema_version`). */
  readonly schemaVersion: number;
}

export type Razon = "formato" | "entidad_inexistente" | "moneda_no_habilitada" | "limite_superado" | "viaje_cerrado" | "fuera_del_viaje";

export type Resultado =
  | { readonly estado: "accepted"; readonly seq: number }
  | { readonly estado: "duplicate" }
  | { readonly estado: "rejected"; readonly razon: Razon };

/** Lo que se guarda de una operación aceptada. Si fue redactada, el payload es null. */
export interface OpGuardada {
  readonly opId: string;
  readonly tipo: string;
  readonly entidadTipo: string;
  readonly entidadId: string;
  readonly hlc: string;
  readonly payload: Campos | null;
  readonly redactada: boolean;
  readonly padreId: string | null;
  readonly schemaVersion: number;
  /** Quién la envió: lo pone el servidor a partir del token, nunca la app. */
  readonly deviceId: string;
  readonly memberId: string;
  /** Hora del servidor (ms) en que se aceptó. */
  readonly aceptadaEn: number;
}

/** El dispositivo e integrante que envía una operación, y la hora del servidor en que se acepta. */
export interface Autor {
  readonly deviceId: string;
  readonly memberId: string;
  readonly aceptadaEn: number;
}

/** Una operación guardada con su número de secuencia. */
export interface OpLeida extends OpGuardada {
  readonly seq: number;
}

export interface IntervaloCierre {
  readonly desdeMs: number;
  /** null mientras el viaje siga cerrado. */
  readonly hastaMs: number | null;
  readonly causa: "MANUAL" | "FECHAS";
}

export interface Almacen {
  /**
   * Ejecuta `fn` como una unidad: si lanza un error se deshace todo lo escrito dentro. Aplicar una operación
   * escribe varias cosas (entidad, campos, redacciones, la operación misma) y debe quedar todo o nada. En
   * SQLite es una transacción inmediata (para que dos conexiones no acepten el mismo `op_id`).
   */
  transaccion<T>(fn: () => T): T;
  opConocida(opId: string): boolean;
  /** Si alguna operación guardada (también las redactadas) usa esa marca. */
  marcaEnUso(hlc: string): boolean;
  entidadExiste(tipo: string, id: string): boolean;
  entidadTerminada(tipo: string, id: string): boolean;
  /** Valor actual de un campo de la entidad, o undefined si no existe la entidad o el campo no tiene valor. */
  /** Id del viaje, o null si todavía no se creó. */
  idDelViaje(): string | null;
  /** Períodos en que el viaje estuvo cerrado, por inicio ascendente; a lo sumo el último está abierto. */
  intervalosDeCierre(): readonly IntervaloCierre[];
  /** Abre un intervalo de cierre; debe empezar después de que termine el anterior y no puede haber otro abierto. */
  abrirIntervalo(desdeMs: number, causa: IntervaloCierre["causa"]): void;
  /** Cierra el intervalo abierto; `hastaMs` debe ser mayor que su inicio. */
  cerrarIntervalo(hastaMs: number): void;
  leerCampo(tipo: string, id: string, campo: string): Json | undefined;
  /** Cuántas entidades de ese tipo existen (las terminadas ya no están). */
  contarEntidades(tipo: string): number;
  leerReloj(tipo: string, id: string, campo: string): string | null;
  /** Crea la entidad vacía si no existe (no hace nada si ya existe). */
  crearEntidad(tipo: string, id: string): void;
  escribirCampo(tipo: string, id: string, campo: string, valor: Json, hlc: string): void;
  /** Identificadores (ordenados) de los adjuntos, también los quitados, cuyo dueño es `ownerId`. */
  adjuntosDe(ownerId: string): string[];
  /** Borra la entidad (si existe) con sus campos y relojes y anota la lápida. Sirve aunque nunca existiera. */
  terminar(tipo: string, id: string): void;
  /** Deja sin payload las operaciones guardadas de esa entidad. */
  redactarPorEntidad(tipo: string, id: string): void;
  /** Deja sin payload las operaciones guardadas cuyo padre es `padreId`. */
  redactarPorPadre(padreId: string): void;
  /** Padre registrado en el sobre de alguna operación guardada de esa entidad (sobrevive a la redacción). */
  padreRegistrado(tipo: string, id: string): string | null;
  /** Guarda la operación y devuelve su número de secuencia (1, 2, 3… sin huecos). */
  guardarOp(op: OpGuardada): number;
  /** Número de secuencia y marca final guardados de una operación, o null si no se guardó (las rechazadas no se guardan). */
  buscarOp(opId: string): { readonly seq: number; readonly hlc: string } | null;
  /** Operaciones guardadas con secuencia mayor que `despuesDe`, en orden de secuencia, hasta `limite`. */
  leerOps(despuesDe: number, limite: number): readonly OpLeida[];
  /** Mayor número de secuencia guardado (0 si no hay ninguna operación). */
  seqMaximo(): number;
  /** Mayor marca guardada de ese dispositivo (el tercer componente de la marca), o null si no tiene ninguna. */
  ultimaMarcaDe(dispositivo: string): string | null;
}

type Clase = "crear" | "editar" | "terminal" | "moneda";

const DEFINICIONES: ReadonlyMap<string, { readonly entidad: string; readonly clase: Clase }> = new Map([
  ["trip.create", { entidad: "trip", clase: "crear" }],
  ["trip.update", { entidad: "trip", clase: "editar" }],
  ["currency.enable", { entidad: "trip_currency", clase: "crear" }],
  ["currency.disable", { entidad: "trip_currency", clase: "moneda" }],
  ["currency.update", { entidad: "trip_currency", clase: "moneda" }],
  ["member.join", { entidad: "member", clase: "crear" }],
  ["member.update", { entidad: "member", clase: "editar" }],
  ["category.create", { entidad: "category", clase: "crear" }],
  ["category.update", { entidad: "category", clase: "editar" }],
  ["category.archive", { entidad: "category", clase: "editar" }],
  ["expense.create", { entidad: "expense", clase: "crear" }],
  ["expense.update", { entidad: "expense", clase: "editar" }],
  ["expense.delete", { entidad: "expense", clase: "editar" }],
  ["expense.restore", { entidad: "expense", clase: "editar" }],
  ["expense.purge", { entidad: "expense", clase: "terminal" }],
  ["fixed.create", { entidad: "fixed_cost", clase: "crear" }],
  ["fixed.update", { entidad: "fixed_cost", clase: "editar" }],
  ["fixed.delete", { entidad: "fixed_cost", clase: "terminal" }],
  ["attachment.add", { entidad: "attachment", clase: "crear" }],
  ["attachment.remove", { entidad: "attachment", clase: "editar" }],
  ["shortcut.create", { entidad: "shortcut", clase: "crear" }],
  ["shortcut.update", { entidad: "shortcut", clase: "editar" }],
  ["shortcut.delete", { entidad: "shortcut", clase: "terminal" }],
  ["cashmove.create", { entidad: "cash_movement", clase: "crear" }],
  ["cashmove.update", { entidad: "cash_movement", clase: "editar" }],
  ["cashmove.delete", { entidad: "cash_movement", clase: "terminal" }],
]);

/** Entidades que pueden tener adjuntos, según el `owner_tipo` del adjunto. */
const DUENOS: ReadonlyMap<string, string> = new Map([
  ["EXPENSE", "expense"],
  ["FIXED_COST", "fixed_cost"],
]);

/** Categoría que nace con el viaje; tiene el mismo id en todos los dispositivos. */
export const CATEGORIA_OTRO = "otro";

const rechazo = (razon: Razon): Resultado => ({ estado: "rejected", razon });

/**
 * Operaciones que tocan un solo campo: no pueden traer otros. Así un cliente no escribe a mano campos
 * derivados (`efectivo_inicial_en`) ni cambia el dueño de un adjunto al quitarlo.
 */
const SOLO_CAMPOS: ReadonlyMap<string, readonly string[]> = new Map([
  ["currency.update", ["tope_minor", "efectivo_inicial_minor"]],
  ["currency.disable", ["habilitada"]],
  ["category.archive", ["archivada"]],
  ["expense.delete", ["eliminado"]],
  ["expense.restore", ["eliminado"]],
  ["attachment.remove", ["quitado"]],
]);

interface MonedaDelViaje {
  readonly codigo: string;
  readonly decimales: number;
  readonly simbolo: string;
}

function leerMonedas(valor: Json | undefined): MonedaDelViaje[] | null {
  if (valor === undefined) return [];
  if (!Array.isArray(valor)) return null;
  const monedas: MonedaDelViaje[] = [];
  const codigos = new Set<string>();
  for (const m of valor as readonly Json[]) {
    if (m === null || typeof m !== "object" || Array.isArray(m)) return null;
    const o = m as { readonly [clave: string]: Json };
    const { codigo, decimales, simbolo } = o;
    if (typeof codigo !== "string" || codigo === "") return null;
    if (typeof decimales !== "number" || !Number.isInteger(decimales)) return null;
    if (typeof simbolo !== "string") return null;
    if (codigos.has(codigo)) return null; // una moneda repetida no tiene un valor único
    codigos.add(codigo);
    monedas.push({ codigo, decimales, simbolo });
  }
  return monedas;
}

export class MotorOperaciones {
  /** Autor de la operación que se está aplicando (solo vale dentro de `aplicar`). */
  private autor: Autor = { deviceId: "", memberId: "", aceptadaEn: 0 };

  constructor(private readonly almacen: Almacen) {}

  /** Aplica la operación como una unidad: o queda todo escrito o no queda nada. */
  aplicar(op: Operacion, autor: Autor): Resultado {
    return this.almacen.transaccion(() => {
      this.autor = autor;
      return this.decidir(op);
    });
  }

  private decidir(op: Operacion): Resultado {
    // Un `tipo` o un `entidadTipo` que no es texto no coincide con la tabla de tipos y se rechaza más abajo.
    for (const texto of [op.opId, op.entidadId, op.hlc] as unknown[]) {
      if (typeof texto !== "string") return rechazo("formato");
    }
    if ((op.payload as Json) === null || typeof op.payload !== "object" || Array.isArray(op.payload)) {
      return rechazo("formato");
    }
    const def = DEFINICIONES.get(op.tipo);
    if (def === undefined || def.entidad !== op.entidadTipo || op.entidadId === "" || op.opId === "") {
      return rechazo("formato");
    }
    const marca = parsearHlc(op.hlc);
    if (!marca.ok) return rechazo("formato");
    if (this.almacen.opConocida(op.opId)) return { estado: "duplicate" };
    // La marca es única por operación (dispositivo y contador). Dos operaciones distintas con la misma marca
    // harían que el estado dependa del orden de llegada, así que la segunda se rechaza.
    if (this.almacen.marcaEnUso(op.hlc)) return rechazo("formato");
    const permitidos = SOLO_CAMPOS.get(op.tipo);
    if (permitidos !== undefined && Object.keys(op.payload).some((k) => !permitidos.includes(k))) {
      return rechazo("formato");
    }

    // `efectivo_inicial_en` es derivado (solo lo escribe el motor) y el dueño solo se fija al agregar el adjunto.
    const claves = Object.keys(op.payload);
    if (claves.includes("efectivo_inicial_en")) return rechazo("formato");
    if (op.tipo !== "attachment.add" && (claves.includes("owner_tipo") || claves.includes("owner_id"))) {
      return rechazo("formato");
    }

    const a = this.almacen;
    const { entidadTipo: tipo, entidadId: id } = op;

    // Un adjunto cuelga de un gasto o de un gasto fijo: ese dueño es su "padre".
    let padreId: string | null = null;
    let duenoTipo: string | null = null;
    if (op.tipo === "attachment.add") {
      const dt = DUENOS.get(typeof op.payload.owner_tipo === "string" ? op.payload.owner_tipo : "");
      const oid = op.payload.owner_id;
      if (dt === undefined || typeof oid !== "string" || oid === "") return rechazo("formato");
      duenoTipo = dt;
      padreId = oid;
    } else if (tipo === "attachment") {
      padreId = a.padreRegistrado(tipo, id);
    }
    // El dueño de un adjunto no cambia: una segunda alta con otro dueño es un error del cliente.
    if (op.tipo === "attachment.add") {
      const previo = a.padreRegistrado(tipo, id);
      if (previo !== null && previo !== padreId) return rechazo("formato");
    }

    if (def.clase === "terminal") return this.terminar(op, padreId);

    // Operaciones sobre algo ya terminado: se aceptan, se guardan redactadas y no cambian nada.
    if (a.entidadTerminada(tipo, id)) return this.guardarRedactada(op, padreId);
    if (duenoTipo !== null && padreId !== null) {
      if (a.entidadTerminada(duenoTipo, padreId)) {
        a.terminar(tipo, id); // el adjunto de un dueño ya purgado nace terminado
        return this.guardarRedactada(op, padreId);
      }
      if (!a.entidadExiste(duenoTipo, padreId)) return rechazo("entidad_inexistente");
    }

    if (def.clase === "editar" && !a.entidadExiste(tipo, id)) return rechazo("entidad_inexistente");
    if (def.clase === "moneda" && !a.entidadExiste(tipo, id)) return rechazo("moneda_no_habilitada");

    let monedas: MonedaDelViaje[] = [];
    if (op.tipo === "trip.create") {
      const leidas = leerMonedas(op.payload.monedas);
      if (leidas === null) return rechazo("formato");
      monedas = leidas;
    }

    if (def.clase === "crear") a.crearEntidad(tipo, id);
    for (const [campo, valor] of Object.entries(op.payload)) {
      if (op.tipo === "trip.create" && campo === "monedas") continue;
      const gano = this.escribir(tipo, id, campo, valor, op.hlc);
      if (gano && op.tipo === "currency.update" && campo === "efectivo_inicial_minor") {
        a.escribirCampo(tipo, id, "efectivo_inicial_en", valor === null ? null : marca.hlc.ms, op.hlc);
      }
    }
    if (op.tipo === "trip.create") this.crearViaje(op.hlc, monedas);

    return { estado: "accepted", seq: a.guardarOp({ ...this.sobre(op, padreId), payload: op.payload, redactada: false }) };
  }

  /** Escribe el campo solo si la marca es mayor que la guardada. */
  private escribir(tipo: string, id: string, campo: string, valor: Json, hlc: string): boolean {
    const actual = this.almacen.leerReloj(tipo, id, campo);
    if (actual !== null && hlc <= actual) return false;
    this.almacen.escribirCampo(tipo, id, campo, valor, hlc);
    return true;
  }

  /** Al crear el viaje nacen la categoría "Otro" y una moneda habilitada por cada moneda del viaje. */
  private crearViaje(hlc: string, monedas: readonly MonedaDelViaje[]): void {
    const a = this.almacen;
    a.crearEntidad("category", CATEGORIA_OTRO);
    this.escribir("category", CATEGORIA_OTRO, "nombre", "Otro", hlc);
    this.escribir("category", CATEGORIA_OTRO, "emoji", "📦", hlc);
    this.escribir("category", CATEGORIA_OTRO, "color", "#EEE8D8", hlc);
    this.escribir("category", CATEGORIA_OTRO, "archivada", 0, hlc);
    for (const m of monedas) {
      a.crearEntidad("trip_currency", m.codigo);
      this.escribir("trip_currency", m.codigo, "habilitada", 1, hlc);
      this.escribir("trip_currency", m.codigo, "decimales", m.decimales, hlc);
      this.escribir("trip_currency", m.codigo, "simbolo", m.simbolo, hlc);
    }
  }

  private terminar(op: Operacion, padreId: string | null): Resultado {
    const a = this.almacen;
    const { entidadTipo: tipo, entidadId: id } = op;
    if (a.entidadTerminada(tipo, id)) return this.guardarRedactada(op, padreId);
    if (!a.entidadExiste(tipo, id)) return rechazo("entidad_inexistente");
    if (tipo === "expense" || tipo === "fixed_cost") {
      for (const adjunto of a.adjuntosDe(id)) a.terminar("attachment", adjunto);
      a.redactarPorPadre(id); // las operaciones de todos sus adjuntos llevan al dueño como padre
    }
    a.terminar(tipo, id);
    a.redactarPorEntidad(tipo, id);
    return this.guardarRedactada(op, padreId);
  }

  private guardarRedactada(op: Operacion, padreId: string | null): Resultado {
    return { estado: "accepted", seq: this.almacen.guardarOp({ ...this.sobre(op, padreId), payload: null, redactada: true }) };
  }

  private sobre(op: Operacion, padreId: string | null) {
    const { deviceId, memberId, aceptadaEn } = this.autor;
    return { opId: op.opId, tipo: op.tipo, entidadTipo: op.entidadTipo, entidadId: op.entidadId, hlc: op.hlc, padreId, schemaVersion: op.schemaVersion, deviceId, memberId, aceptadaEn };
  }
}
