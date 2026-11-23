import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../../src/almacen/operaciones/almacenSqlite.js";
import { abrirBase } from "../../../src/almacen/base/base.js";
import type { Instantanea } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { Ingesta } from "../../../src/dominio/operaciones/ingesta.js";
import type { IntervaloCierre, Json, OpGuardada, Operacion } from "../../../src/dominio/operaciones/operaciones.js";

const leer = <T>(archivo: string): T => JSON.parse(readFileSync(new URL(`../../../../conformance/${archivo}`, import.meta.url), "utf8")) as T;

/** Almacén SQLite que falla en la escritura número `restantes + 1`, antes o justo después de hacerla. */
class AlmacenQueFalla extends AlmacenSqlite {
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
  override redactarPorEntidad(t: string, id: string): void { this.contar("antes"); super.redactarPorEntidad(t, id); this.contar("despues"); }
  override redactarPorPadre(p: string): void { this.contar("antes"); super.redactarPorPadre(p); this.contar("despues"); }
  override guardarOp(op: OpGuardada): number { this.contar("antes"); const n = super.guardarOp(op); this.contar("despues"); return n; }
  override abrirIntervalo(d: number, c: IntervaloCierre["causa"]): void { this.contar("antes"); super.abrirIntervalo(d, c); this.contar("despues"); }
  override cerrarIntervalo(h: number): void { this.contar("antes"); super.cerrarIntervalo(h); this.contar("despues"); }
}

interface Paso { ops: Operacion[]; orden: number[]; ahoras: number[] }

let fallas = 0;

function probar(nombre: string, esc: Paso, esperado: (almacen: AlmacenQueFalla) => void): void {
  it(nombre, () => {
    for (const despues of [false, true]) for (let p = 0; p < esc.orden.length; p++) {
      const almacen = new AlmacenQueFalla(abrirBase(":memory:"), "viaje-1");
      almacen.despues = despues;
      let ahora = 0;
      const ingesta = new Ingesta(almacen, () => ahora);
      const paso = (k: number) => { ahora = esc.ahoras[k] ?? 1; return ingesta.procesar(esc.ops[esc.orden[k] as number] as Operacion); };
      for (let k = 0; k < p; k++) paso(k);
      const antes: Instantanea = almacen.instantanea();
      const intervalosAntes = almacen.intervalosDeCierre();
      const secuenciasAntes = almacen.secuencias();
      for (let r = 0; ; r++) {
        almacen.restantes = r;
        try { paso(p); almacen.restantes = null; break; } catch {
          fallas += 1;
          almacen.restantes = null;
          expect(almacen.instantanea()).toEqual(antes);
          expect(almacen.intervalosDeCierre()).toEqual(intervalosAntes);
          expect(almacen.secuencias()).toEqual(secuenciasAntes);
        }
      }
      for (let k = p + 1; k < esc.orden.length; k++) paso(k);
      esperado(almacen);
      const s = almacen.secuencias();
      expect(s).toEqual(s.map((_, i) => i + 1));
    }
  });
}

describe("SQLite: ingestar una operación es todo o nada (se hace una transacción real)", () => {
  const cierre = leer<{ escenarios: (Paso & { nombre: string; intervalos: IntervaloCierre[] })[] }>("cierre.json");
  for (const esc of cierre.escenarios) probar(`cierre: ${esc.nombre}`, esc, (a) => expect(a.intervalosDeCierre()).toEqual(esc.intervalos));

  const ingesta = leer<{ escenarios: { nombre: string; ops: Operacion[]; orden: number[]; resultados: string[] }[] }>("ingesta.json");
  for (const esc of ingesta.escenarios) {
    probar(`ingesta: ${esc.nombre}`, { ...esc, ahoras: [] }, (a) => {
      expect(a.secuencias().length).toBe(esc.resultados.filter((r) => r === "accepted").length);
    });
  }

  it("se provocaron muchas fallas distintas (la prueba no es vacía)", () => {
    expect(fallas).toBeGreaterThan(200);
  });
});
