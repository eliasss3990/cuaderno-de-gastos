import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_MONTO_MINOR,
  dividirHaciaAbajo,
  formatear,
  formatearEntrada,
  parsear,
  type Moneda,
} from "../../../src/dominio/base/dinero.js";

interface Vectores {
  maxMontoMinor: number;
  monedas: Record<string, { decimales: number; simbolo: string }>;
  formatear: { moneda: string; minor: number; esperado: string }[];
  parsear: { moneda: string; texto: string; esperado?: number; error?: string }[];
  formatearEntrada: { moneda: string; crudo: string; esperado: string }[];
  dividirHaciaAbajo: { a: number; b: number; esperado?: number; error?: boolean }[];
}

const vectores = JSON.parse(
  readFileSync(new URL("../../../../conformance/dinero.json", import.meta.url), "utf8"),
) as Vectores;

function moneda(codigo: string): Moneda {
  const m = vectores.monedas[codigo];
  if (m === undefined) throw new Error(`moneda sin definir en los vectores: ${codigo}`);
  return { codigo, ...m };
}

describe("dinero: vectores de conformidad", () => {
  it("el máximo de los vectores es el del módulo", () => {
    expect(vectores.maxMontoMinor).toBe(MAX_MONTO_MINOR);
  });

  it.each(vectores.formatear)("formatear $moneda $minor -> $esperado", ({ moneda: c, minor, esperado }) => {
    expect(formatear(minor, moneda(c))).toBe(esperado);
  });

  it.each(vectores.parsear)("parsear $moneda '$texto'", ({ moneda: c, texto, esperado, error }) => {
    const r = parsear(texto, moneda(c));
    if (error !== undefined) {
      expect(r).toEqual({ ok: false, error });
    } else {
      expect(r).toEqual({ ok: true, minor: esperado });
    }
  });

  it.each(vectores.formatearEntrada)("formatearEntrada $moneda '$crudo' -> '$esperado'", ({ moneda: c, crudo, esperado }) => {
    expect(formatearEntrada(crudo, moneda(c))).toBe(esperado);
  });

  it.each(vectores.dividirHaciaAbajo)("dividirHaciaAbajo $a / $b", ({ a, b, esperado, error }) => {
    if (error === true) {
      expect(() => dividirHaciaAbajo(a, b)).toThrow(RangeError);
    } else {
      expect(dividirHaciaAbajo(a, b)).toBe(esperado);
    }
  });
});
