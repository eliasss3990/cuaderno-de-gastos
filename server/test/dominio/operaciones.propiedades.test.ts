import { describe, expect, it } from "vitest";
import { AlmacenMemoria, type Instantanea } from "../../src/dominio/almacenMemoria.js";
import { MotorOperaciones, type Campos, type Json, type Operacion, type OpGuardada } from "../../src/dominio/operaciones.js";
import { formatearHlc } from "../../src/dominio/reloj.js";

const DISPOSITIVOS = [
  "018f3a6e-0000-7000-8000-00000000000a",
  "018f3a6e-0000-7000-8000-00000000000b",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
];

function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function elegir<T>(azar: () => number, lista: readonly T[]): T {
  return lista[Math.floor(azar() * lista.length)] as T;
}

function barajar<T>(azar: () => number, lista: readonly T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j] as T, copia[i] as T];
  }
  return copia;
}

const id = (prefijo: string, i: number): string => `${prefijo}-0000-7000-8000-${String(i).padStart(12, "0")}`;

/** Un conjunto de operaciones al azar. Cada marca es única: el contador es distinto en cada operación. */
function generar(azar: () => number): Operacion[] {
  const ops: Operacion[] = [];
  let n = 0;
  const op = (tipo: string, entidadTipo: string, entidadId: string, payload: Campos): Operacion => {
    n += 1;
    const hlc = formatearHlc({ ms: 1 + Math.floor(azar() * 400), contador: n, dispositivo: elegir(azar, DISPOSITIVOS) });
    const o = { opId: id("00000000", n), tipo, entidadTipo, entidadId, hlc, payload };
    ops.push(o);
    return o;
  };

  const gastos = Array.from({ length: 6 }, (_, i) => id("eeeeeeee", i));
  for (const g of gastos) {
    op("expense.create", "expense", g, { monto_minor: 100, concepto: "c" });
    for (let j = Math.floor(azar() * 5); j > 0; j--) {
      const r = azar();
      if (r < 0.25) op("expense.update", "expense", g, { concepto: `c${n}` });
      else if (r < 0.45) op("expense.update", "expense", g, { lugar: `l${n}` });
      else if (r < 0.6) op("expense.update", "expense", g, { nota: azar() < 0.3 ? null : `n${n}` });
      else if (r < 0.8) op("expense.delete", "expense", g, { eliminado: 1 });
      else op("expense.restore", "expense", g, { eliminado: 0 });
    }
    if (azar() < 0.25) op("expense.purge", "expense", g, {});
  }
  const fijos = Array.from({ length: 2 }, (_, i) => id("ffffffff", i));
  for (const f of fijos) {
    op("fixed.create", "fixed_cost", f, { nombre: "h", moneda: "BRL", monto_unitario_minor: 1, cantidad: 2 });
    for (let j = Math.floor(azar() * 3); j > 0; j--) op("fixed.update", "fixed_cost", f, { pagado_en: azar() < 0.3 ? null : n });
    if (azar() < 0.4) op("fixed.delete", "fixed_cost", f, {});
  }
  const duenos: [string, string][] = [...gastos.map((g): [string, string] => ["EXPENSE", g]), ...fijos.map((f): [string, string] => ["FIXED_COST", f])];
  for (let k = 0; k < 6; k++) {
    const [ownerTipo, ownerId] = elegir(azar, duenos);
    const a = id("aaaaaaaa", k);
    op("attachment.add", "attachment", a, { owner_tipo: ownerTipo, owner_id: ownerId, mime: "image/jpeg", bytes: 10 + k, sha256: `h${k}`, tiene_miniatura: 0 });
    if (azar() < 0.4) op("attachment.remove", "attachment", a, { quitado: 1 });
  }
  for (let i = 0; i < 2; i++) {
    const s = id("55555555", i);
    op("shortcut.create", "shortcut", s, { nombre: "p", monto_minor: 5, moneda: "BRL", categoria_id: "otro", orden: i });
    for (let j = Math.floor(azar() * 3); j > 0; j--) op("shortcut.update", "shortcut", s, { orden: n });
    if (azar() < 0.5) op("shortcut.delete", "shortcut", s, {});
    const m = id("66666666", i);
    op("cashmove.create", "cash_movement", m, { tipo: "RETIRO", cuando: 1, monto_minor: 7, moneda: "BRL" });
    for (let j = Math.floor(azar() * 3); j > 0; j--) op("cashmove.update", "cash_movement", m, { monto_minor: n });
    if (azar() < 0.5) op("cashmove.delete", "cash_movement", m, {});
  }
  const cat = id("cccccccc", 0);
  op("category.create", "category", cat, { nombre: "c", color: "#000000", emoji: "x" });
  for (let j = Math.floor(azar() * 4); j > 0; j--) {
    if (azar() < 0.5) op("category.update", "category", cat, { nombre: `c${n}` });
    else op("category.archive", "category", cat, { archivada: azar() < 0.5 ? 1 : 0 });
  }
  const mem = id("dddddddd", 0);
  op("member.join", "member", mem, { apodo: "p", color: "#111111", emoji: "y", es_organizador: 1 });
  for (let j = Math.floor(azar() * 3); j > 0; j--) op("member.update", "member", mem, { apodo: `p${n}` });
  const viaje = id("11111111", 0);
  op("trip.create", "trip", viaje, {
    nombre: "V",
    zona_horaria: "America/Asuncion",
    monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }, { codigo: "BRL", decimales: 2, simbolo: "R$" }],
  });
  for (let j = Math.floor(azar() * 4); j > 0; j--) {
    if (azar() < 0.5) op("trip.update", "trip", viaje, { estado_manual: azar() < 0.4 ? null : "CERRADO" });
    else op("trip.update", "trip", viaje, { nombre: `V${n}` });
  }
  for (let j = Math.floor(azar() * 4); j > 0; j--) {
    const moneda = elegir(azar, ["PYG", "BRL"]);
    if (azar() < 0.5) op("currency.update", "trip_currency", moneda, { tope_minor: n });
    else op("currency.update", "trip_currency", moneda, { efectivo_inicial_minor: azar() < 0.3 ? null : n });
  }
  return ops;
}

const CREAN = new Set(["trip.create", "expense.create", "fixed.create", "attachment.add", "shortcut.create", "cashmove.create", "category.create", "member.join", "currency.enable"]);
const TERMINALES = new Set(["expense.purge", "fixed.delete", "shortcut.delete", "cashmove.delete"]);

/** Un orden de llegada válido: lo que se crea llega antes que lo que se edita; el resto, en cualquier orden. */
function ordenAleatorio(azar: () => number, ops: readonly Operacion[]): Operacion[] {
  const primero = ops.filter((o) => CREAN.has(o.tipo) && o.tipo !== "attachment.add");
  const adjuntos = ops.filter((o) => o.tipo === "attachment.add");
  const resto = ops.filter((o) => !CREAN.has(o.tipo));
  return [...barajar(azar, primero), ...barajar(azar, adjuntos), ...barajar(azar, resto)];
}

/** Otro orden válido: las purgas y borrados terminales llegan antes que los adjuntos (y que las ediciones). */
function ordenTerminalesAntes(azar: () => number, ops: readonly Operacion[]): Operacion[] {
  const primero = ops.filter((o) => CREAN.has(o.tipo) && o.tipo !== "attachment.add");
  const terminales = ops.filter((o) => TERMINALES.has(o.tipo));
  const adjuntos = ops.filter((o) => o.tipo === "attachment.add");
  const resto = ops.filter((o) => !CREAN.has(o.tipo) && !TERMINALES.has(o.tipo));
  return [...barajar(azar, primero), ...barajar(azar, terminales), ...barajar(azar, adjuntos), ...barajar(azar, resto)];
}

function conDuplicados(azar: () => number, orden: readonly Operacion[]): Operacion[] {
  const salida = [...orden];
  for (const o of orden) {
    if (azar() < 0.25) {
      const desde = salida.indexOf(o) + 1;
      salida.splice(desde + Math.floor(azar() * (salida.length - desde + 1)), 0, o);
    }
  }
  return salida;
}

const clave = (tipo: string, i: string): string => `${tipo}\u0000${i}`;
const menor = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Escritura { tipo: string; id: string; campo: string; valor: Json; hlc: string }

/** Lo que escribe cada operación, calculado sin usar el motor. */
function escrituras(o: Operacion): { creaciones: { tipo: string; id: string }[]; escrituras: Escritura[] } {
  const creaciones: { tipo: string; id: string }[] = CREAN.has(o.tipo) ? [{ tipo: o.entidadTipo, id: o.entidadId }] : [];
  const w: Escritura[] = [];
  const poner = (tipo: string, i: string, campo: string, valor: Json): void => { w.push({ tipo, id: i, campo, valor, hlc: o.hlc }); };
  for (const [campo, valor] of Object.entries(o.payload)) {
    if (o.tipo === "trip.create" && campo === "monedas") continue;
    poner(o.entidadTipo, o.entidadId, campo, valor);
    if (o.tipo === "currency.update" && campo === "efectivo_inicial_minor") {
      poner(o.entidadTipo, o.entidadId, "efectivo_inicial_en", valor === null ? null : Number.parseInt(o.hlc.slice(0, 13), 16));
    }
  }
  if (o.tipo === "trip.create") {
    creaciones.push({ tipo: "category", id: "otro" });
    poner("category", "otro", "nombre", "Otro");
    poner("category", "otro", "emoji", "📦");
    poner("category", "otro", "color", "#EEE8D8");
    poner("category", "otro", "archivada", 0);
    for (const m of o.payload.monedas as readonly { codigo: string; decimales: number; simbolo: string }[]) {
      creaciones.push({ tipo: "trip_currency", id: m.codigo });
      poner("trip_currency", m.codigo, "habilitada", 1);
      poner("trip_currency", m.codigo, "decimales", m.decimales);
      poner("trip_currency", m.codigo, "simbolo", m.simbolo);
    }
  }
  return { creaciones, escrituras: w };
}

/** El estado que debe quedar, calculado desde el conjunto de operaciones y no desde el motor. */
function oraculo(ops: readonly Operacion[]): Instantanea {
  const terminados = new Set<string>();
  const idsTerminados = new Set<string>();
  for (const o of ops) {
    if (!TERMINALES.has(o.tipo)) continue;
    terminados.add(clave(o.entidadTipo, o.entidadId));
    if (o.entidadTipo === "expense" || o.entidadTipo === "fixed_cost") idsTerminados.add(o.entidadId);
  }
  const duenoDe = new Map<string, string>();
  for (const o of ops) if (o.tipo === "attachment.add") duenoDe.set(o.entidadId, o.payload.owner_id as string);
  for (const [adjunto, dueno] of duenoDe) if (idsTerminados.has(dueno)) terminados.add(clave("attachment", adjunto));

  const existen = new Map<string, { tipo: string; id: string }>();
  const campos = new Map<string, Map<string, { valor: Json; hlc: string }>>();
  for (const o of ops) {
    const { creaciones, escrituras: w } = escrituras(o);
    for (const c of creaciones) if (!terminados.has(clave(c.tipo, c.id))) existen.set(clave(c.tipo, c.id), c);
    for (const e of w) {
      const k = clave(e.tipo, e.id);
      if (terminados.has(k)) continue;
      const fila = campos.get(k) ?? new Map<string, { valor: Json; hlc: string }>();
      const actual = fila.get(e.campo);
      if (actual === undefined || e.hlc > actual.hlc) fila.set(e.campo, { valor: e.valor, hlc: e.hlc });
      campos.set(k, fila);
    }
  }
  const entidades = [...existen.entries()]
    .sort(([a], [b]) => menor(a, b))
    .map(([k, e]) => {
      const fila = campos.get(k) ?? new Map<string, { valor: Json; hlc: string }>();
      const nombres = [...fila.keys()].sort(menor);
      return {
        tipo: e.tipo,
        id: e.id,
        campos: Object.fromEntries(nombres.map((c) => [c, (fila.get(c) as { valor: Json }).valor])),
        relojes: Object.fromEntries(nombres.map((c) => [c, (fila.get(c) as { hlc: string }).hlc])),
      };
    });
  const lapidas = [...terminados]
    .sort(menor)
    .map((k) => { const [tipo, i] = k.split("\u0000"); return { tipo: tipo as string, id: i as string }; });
  const vistas = new Set<string>();
  const guardadas: OpGuardada[] = [];
  for (const o of ops) {
    if (vistas.has(o.opId)) continue;
    vistas.add(o.opId);
    const padreId = o.tipo === "attachment.add" ? (o.payload.owner_id as string) : o.entidadTipo === "attachment" ? (duenoDe.get(o.entidadId) ?? null) : null;
    const redactada = terminados.has(clave(o.entidadTipo, o.entidadId)) || (padreId !== null && idsTerminados.has(padreId));
    guardadas.push({ opId: o.opId, tipo: o.tipo, entidadTipo: o.entidadTipo, entidadId: o.entidadId, hlc: o.hlc, payload: redactada ? null : o.payload, redactada, padreId });
  }
  guardadas.sort((a, b) => menor(a.opId, b.opId));
  return JSON.parse(JSON.stringify({ entidades, lapidas, ops: guardadas })) as Instantanea;
}

describe("aplicar operaciones: propiedades contra un oráculo independiente", () => {
  const azar = generador(20261123);

  it("el motor llega al estado del oráculo con cualquier orden válido y con duplicados", () => {
    for (let caso = 0; caso < 150; caso++) {
      const ops = generar(azar);
      const esperado = oraculo(ops);
      for (let intento = 0; intento < 4; intento++) {
        const generarOrden = intento % 2 === 0 ? ordenAleatorio : ordenTerminalesAntes;
        const orden = conDuplicados(azar, generarOrden(azar, ops));
        const almacen = new AlmacenMemoria();
        const motor = new MotorOperaciones(almacen);
        const vistas = new Set<string>();
        const secuencias: number[] = [];
        for (const o of orden) {
          const r = motor.aplicar(o);
          if (vistas.has(o.opId)) expect(r.estado).toBe("duplicate");
          else {
            expect(r.estado).toBe("accepted");
            if (r.estado === "accepted") secuencias.push(r.seq);
          }
          vistas.add(o.opId);
        }
        expect(secuencias).toEqual(secuencias.map((_, i) => i + 1));
        expect(almacen.instantanea()).toEqual(esperado);
      }
    }
  });

  it("lo terminado no vuelve: tras una operación terminal, ninguna edición resucita la entidad", () => {
    for (let caso = 0; caso < 60; caso++) {
      const ops = generar(azar);
      const terminadas = new Set(ops.filter((o) => TERMINALES.has(o.tipo)).map((o) => clave(o.entidadTipo, o.entidadId)));
      const almacen = new AlmacenMemoria();
      const motor = new MotorOperaciones(almacen);
      for (const o of ordenAleatorio(azar, ops)) motor.aplicar(o);
      const instantanea = almacen.instantanea();
      for (const e of instantanea.entidades) expect(terminadas.has(clave(e.tipo, e.id))).toBe(false);
      for (const t of terminadas) {
        const [tipo, i] = t.split("\u0000") as [string, string];
        expect(instantanea.lapidas).toContainEqual({ tipo, id: i });
      }
    }
  });

  it("ninguna operación redactada conserva su payload y ninguna operación viva lo pierde", () => {
    for (let caso = 0; caso < 60; caso++) {
      const ops = generar(azar);
      const almacen = new AlmacenMemoria();
      const motor = new MotorOperaciones(almacen);
      for (const o of ordenAleatorio(azar, ops)) motor.aplicar(o);
      const porId = new Map(ops.map((o) => [o.opId, o]));
      for (const g of almacen.instantanea().ops) {
        if (g.redactada) expect(g.payload).toBeNull();
        else expect(g.payload).toEqual((porId.get(g.opId) as Operacion).payload);
      }
    }
  });

  it("otra operación con una marca ya usada se rechaza y no cambia nada", () => {
    for (let caso = 0; caso < 40; caso++) {
      const ops = generar(azar);
      const almacen = new AlmacenMemoria();
      const motor = new MotorOperaciones(almacen);
      for (const o of ordenAleatorio(azar, ops)) motor.aplicar(o);
      const antes = almacen.instantanea();
      for (let i = 0; i < 15; i++) {
        const original = elegir(azar, ops);
        const gemela: Operacion = { ...original, opId: id("ffffffff", 1000 + i) };
        expect(motor.aplicar(gemela)).toEqual({ estado: "rejected", razon: "formato" });
      }
      expect(almacen.instantanea()).toEqual(antes);
    }
  });
});
