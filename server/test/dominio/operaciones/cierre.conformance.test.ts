import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { Ingesta } from "../../../src/dominio/operaciones/ingesta.js";
import type { IntervaloCierre, Operacion, Resultado } from "../../../src/dominio/operaciones/operaciones.js";
import { REMITENTE } from "../../ayudas/autor.js";

interface Escenario {
  nombre: string;
  ops: Operacion[];
  orden: number[];
  ahoras: number[];
  resultados: string[];
  intervalos: IntervaloCierre[];
}
const { escenarios } = JSON.parse(readFileSync(new URL("../../../../conformance/cierre.json", import.meta.url), "utf8")) as { escenarios: Escenario[] };
const describir = (r: Resultado): string => (r.estado === "rejected" ? `rejected:${r.razon}` : r.estado);

describe("cierre del viaje: vectores de conformidad", () => {
  it("hay escenarios alineados", () => {
    expect(escenarios.length).toBeGreaterThanOrEqual(8);
    for (const e of escenarios) {
      expect(e.ahoras).toHaveLength(e.orden.length);
      expect(e.resultados).toHaveLength(e.orden.length);
    }
  });
  for (const esc of escenarios) {
    it(esc.nombre, () => {
      const almacen = new AlmacenMemoria();
      let ahora = 0;
      const ingesta = new Ingesta(almacen, () => ahora);
      const obtenidos = esc.orden.map((i, k) => {
        ahora = esc.ahoras[k] as number;
        return describir(ingesta.procesar(esc.ops[i] as Operacion, REMITENTE));
      });
      expect(obtenidos).toEqual(esc.resultados);
      expect(almacen.intervalosDeCierre()).toEqual(esc.intervalos);
    });
  }
});
