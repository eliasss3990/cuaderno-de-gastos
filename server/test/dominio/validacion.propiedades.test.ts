import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../src/dominio/almacenMemoria.js";
import { MotorOperaciones, type Json, type Operacion } from "../../src/dominio/operaciones.js";
import { validarOperacion } from "../../src/dominio/validacion.js";

interface Valida {
  nombre: string;
  op: Operacion;
  opcionales?: string[];
}

const { validas } = JSON.parse(readFileSync(new URL("../../../conformance/validacion.json", import.meta.url), "utf8")) as { validas: Valida[] };

/** Valores que no son válidos para ningún campo, sea cual sea su tipo. */
const NUNCA_VALIDOS: Json[] = [{}, [], true, false, "x".repeat(5000), 1e300, -1e300];

const clon = (op: Operacion): Operacion => structuredClone(op);

function congelar<T>(x: T): T {
  if (x !== null && typeof x === "object") {
    for (const v of Object.values(x)) congelar(v);
    Object.freeze(x);
  }
  return x;
}

describe("validación de formato: propiedades sobre las operaciones válidas", () => {
  it("agregar un campo que no corresponde invalida cualquier operación", () => {
    for (const { op } of validas) {
      const o = clon(op);
      (o.payload as { [k: string]: Json })["campo_inventado"] = 1;
      expect(validarOperacion(o).ok, op.tipo).toBe(false);
    }
  });

  it("reemplazar cualquier campo por un valor de tipo imposible invalida la operación", () => {
    let comprobaciones = 0;
    for (const { op } of validas) {
      for (const campo of Object.keys(op.payload)) {
        for (const malo of NUNCA_VALIDOS) {
          const o = clon(op);
          (o.payload as { [k: string]: Json })[campo] = malo;
          expect(validarOperacion(o).ok, `${op.tipo}.${campo}=${JSON.stringify(malo).slice(0, 20)}`).toBe(false);
          comprobaciones += 1;
        }
      }
    }
    expect(comprobaciones).toBeGreaterThan(1000);
  });

  it("quitar un campo obligatorio de una alta la invalida, y quitar todos los opcionales la deja válida", () => {
    for (const { op, opcionales } of validas) {
      if (opcionales === undefined) continue;
      for (const campo of Object.keys(op.payload)) {
        if (opcionales.includes(campo)) continue;
        const o = clon(op);
        delete (o.payload as { [k: string]: Json })[campo];
        // un cambio de dinero de un movimiento se señala por el tipo; en todo caso debe rechazarse
        expect(validarOperacion(o).ok, `${op.tipo} sin ${campo}`).toBe(false);
      }
      const solo = clon(op);
      for (const campo of opcionales) delete (solo.payload as { [k: string]: Json })[campo];
      expect(validarOperacion(solo).ok, `${op.tipo} sin opcionales`).toBe(true);
    }
  });

  it("cambiar el tipo de entidad, el id de la operación o la marca por algo inválido invalida la operación", () => {
    for (const { op } of validas) {
      for (const cambio of [{ entidadTipo: "otra_cosa" }, { opId: "no-es-uuid" }, { hlc: "no-es-una-marca" }, { entidadId: "" }] as const) {
        expect(validarOperacion({ ...clon(op), ...cambio }).ok, `${op.tipo} ${JSON.stringify(cambio)}`).toBe(false);
      }
    }
  });

  it("validar no modifica la operación (una operación congelada se valida sin error)", () => {
    for (const { op } of validas) {
      const congelada = congelar(clon(op));
      expect(() => validarOperacion(congelada)).not.toThrow();
      expect(congelada).toEqual(op);
    }
  });

  it("es determinista: validar dos veces da el mismo resultado", () => {
    for (const { op } of validas) expect(validarOperacion(op)).toEqual(validarOperacion(clon(op)));
  });

  it("lo que el validador acepta nunca lo rechaza el motor por formato", () => {
    for (const { op, nombre } of validas) {
      const motor = new MotorOperaciones(new AlmacenMemoria());
      const r = motor.aplicar(clon(op));
      expect(r.estado === "rejected" && r.razon === "formato", `el motor rechaza por formato: ${nombre}`).toBe(false);
    }
  });

  it("una propiedad heredada del prototipo no cuenta como campo presente", () => {
    const base = validas.find((v) => v.op.tipo === "expense.create" && v.nombre.startsWith("base de "))!.op;
    const { moneda, ...resto } = base.payload;
    const heredado = Object.assign(Object.create({ moneda }) as object, resto) as Operacion["payload"];
    const r = validarOperacion({ ...clon(base), payload: heredado });
    expect(r).toMatchObject({ ok: false, campo: "moneda" });

    // un campo opcional heredado, aunque su valor sea inválido, se ignora por completo (el motor tampoco lo lee)
    const conHeredadoInvalido = Object.assign(Object.create({ concepto: 5 }) as object, base.payload, { concepto: undefined }) as Operacion["payload"];
    delete (conHeredadoInvalido as { [k: string]: Json | undefined })["concepto"];
    expect(validarOperacion({ ...clon(base), payload: conHeredadoInvalido }).ok).toBe(true);

    const ubicacion = validas.find((v) => v.nombre === "ubicación en los extremos")!.op;
    const sinLon = Object.assign(Object.create({ lon: 10 }) as object, { lat: 5 }) as Operacion["payload"];
    expect(validarOperacion({ ...clon(ubicacion), payload: sinLon }).ok).toBe(false);
  });

  it("un campo desconocido muy largo se señala truncado", () => {
    const o = clon(validas[0]!.op);
    (o.payload as { [k: string]: Json })["z".repeat(5000)] = 1;
    const r = validarOperacion(o);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.campo).toHaveLength(64);
  });
});
