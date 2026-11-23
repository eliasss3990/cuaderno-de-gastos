import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../src/dominio/almacenMemoria.js";
import { Ingesta } from "../../src/dominio/ingesta.js";
import type { Campos, Operacion } from "../../src/dominio/operaciones.js";
import { formatearHlc } from "../../src/dominio/reloj.js";

const DISPOSITIVOS = ["018f3a6e-0000-7000-8000-00000000000a", "018f3a6e-0000-7000-8000-00000000000b"];

function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const elegir = <T>(azar: () => number, lista: readonly T[]): T => lista[Math.floor(azar() * lista.length)] as T;
function barajar<T>(azar: () => number, lista: readonly T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j] as T, copia[i] as T];
  }
  return copia;
}

const uid = (tipo: string, i: number): string => `018f3a6e-${tipo}-7000-8000-${String(i).padStart(12, "0")}`;
const aid = (i: number): string => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`;
const MONEDAS = ["PYG", "BRL", "EUR", "USD"];
const T = 1700000000000;

/** Tipo de movimiento y el dinero que le corresponde, escrito aparte del código que se prueba. */
const DINERO: { [tipo: string]: string[] } = {
  CAMBIO: ["moneda_sale", "monto_sale_minor", "moneda_entra", "monto_entra_minor"],
  RETIRO: ["moneda_entra", "monto_entra_minor"],
  AJUSTE: ["moneda_ajuste", "saldo_ajuste_minor"],
};

/** Operaciones de formato válido con referencias a monedas y categorías que a veces no existen. */
function generar(azar: () => number): Operacion[] {
  const ops: Operacion[] = [];
  let n = 0;
  const op = (tipo: string, entidadTipo: string, entidadId: string, payload: Campos): Operacion => {
    n += 1;
    const o = {
      opId: `018f3a6e-9000-7000-8000-${String(n).padStart(12, "0")}`,
      tipo,
      entidadTipo,
      entidadId,
      hlc: formatearHlc({ ms: 1 + Math.floor(azar() * 1000), contador: n, dispositivo: elegir(azar, DISPOSITIVOS) }),
      payload,
    };
    ops.push(o);
    return o;
  };
  const categoria = (): string => elegir(azar, ["otro", "otro", uid("7000", 1), uid("7000", 2), uid("7000", 99)]);
  const moneda = (): string => elegir(azar, MONEDAS);

  op("trip.create", "trip", uid("1000", 1), { nombre: "V", zona_horaria: "America/Asuncion", monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }, { codigo: "BRL", decimales: 2, simbolo: "R$" }] });
  for (const m of ["EUR", "USD"]) {
    if (azar() < 0.6) op("currency.enable", "trip_currency", m, { habilitada: 1, decimales: 2, simbolo: m });
    if (azar() < 0.3) op("currency.disable", "trip_currency", m, { habilitada: 0 });
  }
  for (const i of [1, 2]) {
    if (azar() < 0.8) op("category.create", "category", uid("7000", i), { nombre: `C${i}`, color: "#E8E4F3", emoji: "x" });
    if (azar() < 0.3) op("category.archive", "category", uid("7000", i), { archivada: 1 });
  }
  const gastos = Array.from({ length: 6 }, (_, i) => uid("2000", i));
  for (const g of gastos) {
    op("expense.create", "expense", g, { monto_minor: 100, moneda: moneda(), categoria_id: categoria(), cuando_ocurrio: T, dia_imputado: "2027-02-18" });
    for (let j = Math.floor(azar() * 3); j > 0; j--) {
      const r = azar();
      if (r < 0.4) op("expense.update", "expense", g, { moneda: moneda() });
      else if (r < 0.8) op("expense.update", "expense", g, { categoria_id: categoria() });
      else op("expense.update", "expense", g, { concepto: `c${n}` });
    }
    if (azar() < 0.15) op("expense.purge", "expense", g, {});
  }
  const fijos = [uid("3000", 1), uid("3000", 2)];
  for (const f of fijos) {
    op("fixed.create", "fixed_cost", f, { nombre: "H", moneda: moneda(), monto_unitario_minor: 1, cantidad: 1 });
    if (azar() < 0.5) op("fixed.update", "fixed_cost", f, { moneda: moneda() });
  }
  const duenos: [string, string][] = [...gastos.map((g): [string, string] => ["EXPENSE", g]), ...fijos.map((f): [string, string] => ["FIXED_COST", f])];
  for (let k = 0; k < 14; k++) {
    const [ownerTipo, ownerId] = elegir(azar, duenos);
    op("attachment.add", "attachment", aid(k), { owner_tipo: ownerTipo, owner_id: ownerId, mime: "image/png", bytes: 5, sha256: "ab".repeat(32), tiene_miniatura: 0 });
    if (azar() < 0.35) op("attachment.remove", "attachment", aid(k), { quitado: 1 });
  }
  for (let k = 0; k < 12; k++) {
    const s = uid("4000", k);
    op("shortcut.create", "shortcut", s, { nombre: `A${k}`, monto_minor: 5, moneda: moneda(), categoria_id: categoria(), orden: k });
    if (azar() < 0.3) op("shortcut.update", "shortcut", s, { categoria_id: categoria() });
    if (azar() < 0.3) op("shortcut.delete", "shortcut", s, {});
  }
  for (let k = 0; k < 4; k++) {
    const m = uid("5000", k);
    const tipo = elegir(azar, ["CAMBIO", "CAMBIO", "RETIRO", "AJUSTE"]);
    const cuerpo: Campos =
      tipo === "CAMBIO" ? { tipo, cuando: T, moneda_sale: "PYG", monto_sale_minor: 5, moneda_entra: "BRL", monto_entra_minor: 5 }
      : tipo === "RETIRO" ? { tipo, cuando: T, moneda_entra: moneda(), monto_entra_minor: 5 }
      : { tipo, cuando: T, moneda_ajuste: moneda(), saldo_ajuste_minor: 5 };
    op("cashmove.create", "cash_movement", m, cuerpo);
    for (let j = Math.floor(azar() * 8); j > 0; j--) {
      const campo = elegir(azar, ["moneda_sale", "moneda_entra", "moneda_ajuste", "monto_entra_minor", "saldo_ajuste_minor", "nota"]);
      const cambios: { [c: string]: string | number } =
        campo.startsWith("moneda_") ? { [campo]: moneda() } : campo === "nota" ? { nota: "x" } : { [campo]: 7 };
      if (campo === "moneda_sale" && azar() < 0.5) cambios.moneda_entra = moneda(); // a veces se cambian las dos a la vez
      op("cashmove.update", "cash_movement", m, cambios);
    }
  }
  return ops;
}

function conDuplicados(azar: () => number, orden: readonly Operacion[]): Operacion[] {
  const salida = [...orden];
  for (const o of orden) {
    if (azar() < 0.2) {
      const desde = salida.indexOf(o) + 1;
      salida.splice(desde + Math.floor(azar() * (salida.length - desde + 1)), 0, o);
    }
  }
  return salida;
}

describe("ingesta de operaciones: las invariantes del modelo se cumplen siempre", () => {
  const azar = generador(20261123);

  it("tras cualquier orden de llegada: referencias que existen, límites y movimientos coherentes", () => {
    for (let caso = 0; caso < 200; caso++) {
      const ops = generar(azar);
      const primero = ops[0] as Operacion;
      const resto = barajar(azar, ops.slice(1));
      const orden = conDuplicados(azar, caso % 2 === 0 ? [primero, ...resto] : barajar(azar, ops));

      const almacen = new AlmacenMemoria();
      const ingesta = new Ingesta(almacen);
      const vistas = new Set<string>();
      let aceptadas = 0;
      for (const o of orden) {
        const r = ingesta.procesar(o);
        if (vistas.has(o.opId)) expect(r.estado).toBe("duplicate");
        if (r.estado === "accepted") aceptadas += 1;
        // si se aceptó, no pudo ser un duplicado; las razones posibles son las del plan
        if (r.estado === "rejected") expect(["formato", "entidad_inexistente", "moneda_no_habilitada", "limite_superado"]).toContain(r.razon);
        if (r.estado !== "rejected") vistas.add(o.opId);
      }
      expect(almacen.secuencias()).toEqual(Array.from({ length: aceptadas }, (_, i) => i + 1));

      const { entidades } = almacen.instantanea();
      const de = (tipo: string) => entidades.filter((e) => e.tipo === tipo);
      const monedas = new Set(de("trip_currency").map((e) => e.id));
      const categorias = new Set(de("category").map((e) => e.id));

      for (const e of [...de("expense"), ...de("fixed_cost"), ...de("shortcut")]) {
        if (e.campos.moneda !== undefined) expect(monedas.has(e.campos.moneda as string), `${e.tipo} con una moneda que el viaje no tiene`).toBe(true);
      }
      for (const e of [...de("expense"), ...de("shortcut")]) {
        if (e.campos.categoria_id !== undefined) expect(categorias.has(e.campos.categoria_id as string), `${e.tipo} con una categoría que no existe`).toBe(true);
      }
      expect(de("shortcut").length).toBeLessThanOrEqual(6);
      const activosPorDueno = new Map<string, number>();
      for (const a of de("attachment")) {
        if (a.campos.quitado === 1) continue;
        const dueno = a.campos.owner_id as string;
        activosPorDueno.set(dueno, (activosPorDueno.get(dueno) ?? 0) + 1);
      }
      for (const [dueno, cantidad] of activosPorDueno) expect(cantidad, `adjuntos activos de ${dueno}`).toBeLessThanOrEqual(3);

      for (const m of de("cash_movement")) {
        const tipo = m.campos.tipo as string;
        for (const campo of ["moneda_sale", "moneda_entra", "moneda_ajuste"]) {
          if (m.campos[campo] !== undefined) expect(monedas.has(m.campos[campo] as string)).toBe(true);
        }
        for (const campo of Object.keys(m.campos)) {
          if (!["tipo", "cuando", "nota"].includes(campo)) expect(DINERO[tipo], `campo ${campo} en un ${tipo}`).toContain(campo);
        }
        if (tipo === "CAMBIO") expect(m.campos.moneda_sale, "un cambio con las dos monedas iguales").not.toBe(m.campos.moneda_entra);
      }
    }
  });

  it("algo que ni siquiera es un objeto se rechaza por formato sin romper nada", () => {
    const almacen = new AlmacenMemoria();
    const ingesta = new Ingesta(almacen);
    for (const basura of [null, undefined, 5, "texto", true, [], [1, 2]]) {
      expect(ingesta.procesar(basura as unknown as Operacion)).toEqual({ estado: "rejected", razon: "formato" });
    }
    expect(almacen.secuencias()).toEqual([]);
  });
});
