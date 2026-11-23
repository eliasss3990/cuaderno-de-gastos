import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../src/almacen/almacenSqlite.js";
import { abrirBase } from "../../src/almacen/base.js";
import { AlmacenMemoria, type Instantanea } from "../../src/dominio/almacenMemoria.js";
import { Ingesta } from "../../src/dominio/ingesta.js";
import { MotorOperaciones, type IntervaloCierre, type Operacion, type Resultado } from "../../src/dominio/operaciones.js";
import { barajar, conDuplicados, generador, generar } from "../ayudas/operacionesAleatorias.js";

const leer = <T>(archivo: string): T => JSON.parse(readFileSync(new URL(`../../../conformance/${archivo}`, import.meta.url), "utf8")) as T;
const describir = (r: Resultado): string => (r.estado === "rejected" ? `rejected:${r.razon}` : r.estado);
const sqlite = (): AlmacenSqlite => new AlmacenSqlite(abrirBase(":memory:"), "viaje-1");

describe("almacén SQLite: los vectores de operaciones llegan al estado esperado en todos los órdenes", () => {
  const { escenarios } = leer<{ escenarios: { nombre: string; ops: Operacion[]; ordenes: number[][]; resultados: string[]; esperado: Instantanea }[] }>("operaciones.json");
  for (const esc of escenarios) {
    it(esc.nombre, () => {
      for (const orden of esc.ordenes) {
        const almacen = sqlite();
        const motor = new MotorOperaciones(almacen);
        for (const i of orden) motor.aplicar(esc.ops[i] as Operacion);
        expect(almacen.instantanea()).toEqual(esc.esperado);
        const s = almacen.secuencias();
        expect(s).toEqual(s.map((_, i) => i + 1));
      }
    });
  }
});

describe("almacén SQLite: igual que el de memoria en la ingesta, el cierre y los datos aleatorios", () => {
  function correr(almacen: AlmacenMemoria | AlmacenSqlite, ops: readonly Operacion[], orden: readonly number[], ahoras: readonly number[]) {
    let ahora = 0;
    const ingesta = new Ingesta(almacen, () => ahora);
    const resultados = orden.map((i, k) => {
      ahora = ahoras[k] ?? 1;
      return describir(ingesta.procesar(ops[i] as Operacion));
    });
    return { resultados, estado: almacen.instantanea(), intervalos: almacen.intervalosDeCierre(), secuencias: almacen.secuencias() };
  }

  it("escenarios de ingesta", () => {
    const { escenarios } = leer<{ escenarios: { nombre: string; ops: Operacion[]; orden: number[]; resultados: string[] }[] }>("ingesta.json");
    for (const e of escenarios) {
      const enSqlite = correr(sqlite(), e.ops, e.orden, []);
      expect(enSqlite.resultados, e.nombre).toEqual(e.resultados);
      expect(enSqlite, e.nombre).toEqual(correr(new AlmacenMemoria(), e.ops, e.orden, []));
    }
  });

  it("escenarios de cierre del viaje, con la hora del servidor en cada paso", () => {
    const { escenarios } = leer<{ escenarios: { nombre: string; ops: Operacion[]; orden: number[]; ahoras: number[]; resultados: string[]; intervalos: IntervaloCierre[] }[] }>("cierre.json");
    for (const e of escenarios) {
      const enSqlite = correr(sqlite(), e.ops, e.orden, e.ahoras);
      expect(enSqlite.resultados, e.nombre).toEqual(e.resultados);
      expect(enSqlite.intervalos, e.nombre).toEqual(e.intervalos);
      expect(enSqlite, e.nombre).toEqual(correr(new AlmacenMemoria(), e.ops, e.orden, e.ahoras));
    }
  });

  it("las entidades y lápidas con caracteres fuera del plano básico se ordenan igual que en memoria", () => {
    const ids = ["\uFF5E", "\u{1F600}", "a", "Z", "é", "\u0001"];
    const llenar = (a: AlmacenMemoria | AlmacenSqlite) => {
      ids.forEach((id, i) => {
        a.crearEntidad("expense", id);
        a.escribirCampo("expense", id, "nota", id, `${(i + 1).toString(16).padStart(13, "0")}-0000-018f3a6e-0000-7000-8000-00000000000a`);
        a.terminar("shortcut", id);
      });
      return a.instantanea();
    };
    expect(llenar(sqlite())).toEqual(llenar(new AlmacenMemoria()));
  });

  it("200 recorridos aleatorios con órdenes de llegada y duplicados dan lo mismo en los dos almacenes", () => {
    const azar = generador(20261124);
    for (let caso = 0; caso < 200; caso++) {
      const ops = generar(azar);
      const llegada = conDuplicados(azar, caso % 2 === 0 ? [ops[0] as Operacion, ...barajar(azar, ops.slice(1))] : barajar(azar, ops));
      const orden = llegada.map((o) => ops.indexOf(o));
      const enMemoria = correr(new AlmacenMemoria(), ops, orden, []);
      const enSqlite = correr(sqlite(), ops, orden, []);
      expect(enSqlite, `caso ${caso}`).toEqual(enMemoria);
    }
  });
});
