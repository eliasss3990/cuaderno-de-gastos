import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { Ingesta } from "../../../src/dominio/operaciones/ingesta.js";
import type { IntervaloCierre, Json, OpGuardada, Operacion } from "../../../src/dominio/operaciones/operaciones.js";

interface Escenario { nombre: string; ops: Operacion[]; orden: number[]; ahoras: number[]; intervalos: IntervaloCierre[] }
const { escenarios } = JSON.parse(readFileSync(new URL("../../../../conformance/cierre.json", import.meta.url), "utf8")) as { escenarios: Escenario[] };

/** Almacén que falla en la escritura número `restantes + 1` (antes o justo después de hacerla). */
class AlmacenQueFalla extends AlmacenMemoria {
  restantes: number | null = null;
  despues = false;
  private contar(fase: "antes" | "despues"): void {
    if ((fase === "despues") !== this.despues || this.restantes === null) return;
    if (this.restantes === 0) throw new Error("falla inyectada");
    this.restantes -= 1;
  }
  override crearEntidad(t: string, id: string): void { this.contar("antes"); super.crearEntidad(t, id); this.contar("despues"); }
  override escribirCampo(t: string, id: string, c: string, v: Json, h: string): void { this.contar("antes"); super.escribirCampo(t, id, c, v, h); this.contar("despues"); }
  override terminar(t: string, id: string): void { this.contar("antes"); super.terminar(t, id); this.contar("despues"); }
  override guardarOp(op: OpGuardada): number { this.contar("antes"); const n = super.guardarOp(op); this.contar("despues"); return n; }
  override abrirIntervalo(d: number, c: IntervaloCierre["causa"]): void { this.contar("antes"); super.abrirIntervalo(d, c); this.contar("despues"); }
  override cerrarIntervalo(h: number): void { this.contar("antes"); super.cerrarIntervalo(h); this.contar("despues"); }
}

describe("ingestar una operación es todo o nada, también con los intervalos de cierre", () => {
  let fallas = 0;
  for (const esc of escenarios) {
    it(esc.nombre, () => {
      for (const despues of [false, true]) for (let p = 0; p < esc.orden.length; p++) {
        const almacen = new AlmacenQueFalla();
        almacen.despues = despues;
        let ahora = 0;
        const ingesta = new Ingesta(almacen, () => ahora);
        const paso = (k: number) => { ahora = esc.ahoras[k] as number; return ingesta.procesar(esc.ops[esc.orden[k] as number] as Operacion); };
        for (let k = 0; k < p; k++) paso(k);
        const antes = almacen.instantanea();
        const intervalosAntes = almacen.intervalosDeCierre();
        for (let r = 0; ; r++) {
          almacen.restantes = r;
          try { paso(p); almacen.restantes = null; break; } catch {
            fallas += 1;
            almacen.restantes = null;
            expect(almacen.instantanea()).toEqual(antes);
            expect(almacen.intervalosDeCierre()).toEqual(intervalosAntes);
          }
        }
        for (let k = p + 1; k < esc.orden.length; k++) paso(k);
        expect(almacen.intervalosDeCierre()).toEqual(esc.intervalos);
        const s = almacen.secuencias();
        expect(s).toEqual(s.map((_, i) => i + 1));
      }
    });
  }
  it("se provocaron muchas fallas", () => expect(fallas).toBeGreaterThan(100));
});
