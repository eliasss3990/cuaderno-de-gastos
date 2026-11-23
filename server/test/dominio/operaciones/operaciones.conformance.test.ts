import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria, type Instantanea } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { MotorOperaciones, type Operacion, type Resultado } from "../../../src/dominio/operaciones/operaciones.js";

interface Escenario {
  nombre: string;
  ops: Operacion[];
  ordenes: number[][];
  resultados: string[];
  esperado: Instantanea;
}

const vectores = JSON.parse(
  readFileSync(new URL("../../../../conformance/operaciones.json", import.meta.url), "utf8"),
) as { escenarios: Escenario[] };

function describir(r: Resultado): string {
  return r.estado === "rejected" ? `rejected:${r.razon}` : r.estado;
}

function ejecutar(esc: Escenario, orden: readonly number[]): { almacen: AlmacenMemoria; resultados: Resultado[] } {
  const almacen = new AlmacenMemoria();
  const motor = new MotorOperaciones(almacen);
  const resultados = orden.map((i) => motor.aplicar(esc.ops[i] as Operacion));
  return { almacen, resultados };
}

describe("aplicar operaciones: vectores de conformidad", () => {
  it("hay escenarios y cada uno tiene al menos un orden", () => {
    expect(vectores.escenarios.length).toBeGreaterThan(10);
    for (const e of vectores.escenarios) expect(e.ordenes.length).toBeGreaterThan(0);
  });

  for (const esc of vectores.escenarios) {
    describe(esc.nombre, () => {
      esc.ordenes.forEach((orden, k) => {
        it(`orden ${k + 1} [${orden.join(",")}] llega al estado esperado`, () => {
          const { almacen, resultados } = ejecutar(esc, orden);
          expect(almacen.instantanea()).toEqual(esc.esperado);
          const aceptadas = resultados.flatMap((r) => (r.estado === "accepted" ? [r.seq] : []));
          expect(aceptadas).toEqual(aceptadas.map((_, i) => i + 1)); // secuencia 1, 2, 3 sin huecos
          expect(almacen.secuencias()).toEqual(aceptadas);
          expect(aceptadas.length).toBe(esc.esperado.ops.length); // lo rechazado y lo duplicado no se guarda
          if (k === 0) expect(resultados.map(describir)).toEqual(esc.resultados);
        });
      });

      it("repetir lo que se aceptó da duplicado y no cambia el estado", () => {
        const orden = esc.ordenes[0] as number[];
        const { almacen, resultados } = ejecutar(esc, orden);
        const motor = new MotorOperaciones(almacen);
        orden.forEach((i, k) => {
          if ((resultados[k] as Resultado).estado === "accepted") {
            expect(motor.aplicar(esc.ops[i] as Operacion)).toEqual({ estado: "duplicate" });
          }
        });
        expect(almacen.instantanea()).toEqual(esc.esperado);
      });

      it("lo rechazado no deja rastro: mandarlo de nuevo con el mismo estado vuelve a rechazarse igual", () => {
        const orden = esc.ordenes[0] as number[];
        const { almacen, resultados } = ejecutar(esc, orden);
        const motor = new MotorOperaciones(almacen);
        orden.forEach((i, k) => {
          const antes = resultados[k] as Resultado;
          if (antes.estado === "rejected" && antes.razon === "formato") {
            expect(motor.aplicar(esc.ops[i] as Operacion)).toEqual(antes);
          }
        });
        expect(almacen.instantanea()).toEqual(esc.esperado);
      });
    });
  }
});
