import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Campos, Json, Operacion } from "../../../src/dominio/operaciones/operaciones.js";
import { validarOperacion } from "../../../src/dominio/operaciones/validacion.js";

interface Valida {
  nombre: string;
  op: Operacion;
  opcionales?: string[];
}

interface Invalida {
  nombre: string;
  base: string;
  campo: string;
  sobre?: { [campo: string]: Json };
  payload?: Campos;
  quitar?: string[];
  payloadCompleto?: Json;
}

const vectores = JSON.parse(readFileSync(new URL("../../../../conformance/validacion.json", import.meta.url), "utf8")) as {
  validas: Valida[];
  invalidas: Invalida[];
};

const bases = new Map(vectores.validas.filter((v) => v.nombre.startsWith("base de ")).map((v) => [v.op.tipo, v.op]));

/** Reconstruye la operación de un caso inválido aplicando su parche sobre la base. */
function armar(caso: Invalida): Operacion {
  const base = bases.get(caso.base);
  if (base === undefined) throw new Error(`no hay base ${caso.base}`);
  const op = structuredClone(base) as unknown as { [k: string]: unknown; payload: unknown };
  Object.assign(op, caso.sobre ?? {});
  if ("payloadCompleto" in caso) {
    op.payload = structuredClone(caso.payloadCompleto);
  } else {
    const payload = op.payload as { [k: string]: Json };
    for (const k of caso.quitar ?? []) delete payload[k];
    // propiedades propias (como las que produce JSON.parse): Object.assign con `__proto__` cambiaría el prototipo
    for (const [k, v] of Object.entries(structuredClone(caso.payload ?? {}))) {
      Object.defineProperty(payload, k, { value: v, enumerable: true, writable: true, configurable: true });
    }
  }
  return op as unknown as Operacion;
}

describe("validación de formato: vectores de conformidad", () => {
  it("hay una base por cada tipo de operación y muchos casos", () => {
    expect(bases.size).toBe(26);
    expect(vectores.validas.length).toBeGreaterThan(60);
    expect(vectores.invalidas.length).toBeGreaterThan(1000);
  });

  it.each(vectores.validas)("válida: $nombre", ({ op }) => {
    expect(validarOperacion(op)).toEqual({ ok: true });
  });

  it.each(vectores.invalidas)("inválida: $nombre", (caso) => {
    const r = validarOperacion(armar(caso));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.campo).toBe(caso.campo);
  });
});
