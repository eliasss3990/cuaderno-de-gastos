// Generador de operaciones de formato válido con referencias que a veces no existen, para pruebas de propiedades.
import type { Campos, Operacion } from "../../src/dominio/operaciones/operaciones.js";
import { formatearHlc } from "../../src/dominio/base/reloj.js";

const DISPOSITIVOS = ["018f3a6e-0000-7000-8000-00000000000a", "018f3a6e-0000-7000-8000-00000000000b"];

export function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const elegir = <T>(azar: () => number, lista: readonly T[]): T => lista[Math.floor(azar() * lista.length)] as T;
export function barajar<T>(azar: () => number, lista: readonly T[]): T[] {
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
export const DINERO: { [tipo: string]: string[] } = {
  CAMBIO: ["moneda_sale", "monto_sale_minor", "moneda_entra", "monto_entra_minor"],
  RETIRO: ["moneda_entra", "monto_entra_minor"],
  AJUSTE: ["moneda_ajuste", "saldo_ajuste_minor"],
};

/** Operaciones de formato válido con referencias a monedas y categorías que a veces no existen. */
export function generar(azar: () => number): Operacion[] {
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

export function conDuplicados(azar: () => number, orden: readonly Operacion[]): Operacion[] {
  const salida = [...orden];
  for (const o of orden) {
    if (azar() < 0.2) {
      const desde = salida.indexOf(o) + 1;
      salida.splice(desde + Math.floor(azar() * (salida.length - desde + 1)), 0, o);
    }
  }
  return salida;
}

