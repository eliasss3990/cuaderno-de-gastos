import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { Ingesta } from "../../../src/dominio/operaciones/ingesta.js";
import type { Operacion, Resultado } from "../../../src/dominio/operaciones/operaciones.js";
import { REMITENTE } from "../../ayudas/autor.js";

interface Escenario {
  nombre: string;
  ops: Operacion[];
  orden: number[];
  resultados: string[];
  cuentas?: { [tipo: string]: number };
}

const vectores = JSON.parse(readFileSync(new URL("../../../../conformance/ingesta.json", import.meta.url), "utf8")) as { escenarios: Escenario[] };

const describir = (r: Resultado): string => (r.estado === "rejected" ? `rejected:${r.razon}` : r.estado);

describe("ingesta de operaciones: vectores de conformidad", () => {
  it("hay escenarios y cada uno tiene un resultado por paso", () => {
    expect(vectores.escenarios.length).toBeGreaterThanOrEqual(10);
    for (const e of vectores.escenarios) expect(e.resultados).toHaveLength(e.orden.length);
  });

  for (const esc of vectores.escenarios) {
    it(esc.nombre, () => {
      const almacen = new AlmacenMemoria();
      const ingesta = new Ingesta(almacen);
      const obtenidos = esc.orden.map((i) => describir(ingesta.procesar(esc.ops[i] as Operacion, REMITENTE)));
      expect(obtenidos).toEqual(esc.resultados);
      // solo lo aceptado queda guardado, con secuencia 1, 2, 3 sin huecos
      const aceptadas = esc.resultados.filter((r) => r === "accepted").length;
      expect(almacen.secuencias()).toEqual(Array.from({ length: aceptadas }, (_, i) => i + 1));
      const entidades = almacen.instantanea().entidades;
      for (const [tipo, n] of Object.entries(esc.cuentas ?? {})) {
        expect(entidades.filter((e) => e.tipo === tipo).length, `entidades de tipo ${tipo}`).toBe(n);
      }
    });
  }
});
