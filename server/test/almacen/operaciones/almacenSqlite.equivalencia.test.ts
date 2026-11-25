import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../../src/almacen/operaciones/almacenSqlite.js";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { AlmacenMemoria, type Instantanea } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { Ingesta } from "../../../src/dominio/operaciones/ingesta.js";
import { RecepcionDeOperaciones } from "../../../src/dominio/operaciones/recepcion.js";
import { formatearHlc, parsearHlc } from "../../../src/dominio/base/reloj.js";
import { MotorOperaciones, type IntervaloCierre, type Operacion, type Resultado } from "../../../src/dominio/operaciones/operaciones.js";
import { barajar, conDuplicados, generador, generar } from "../../ayudas/operacionesAleatorias.js";
import { AUTOR, REMITENTE, remitenteDe } from "../../ayudas/autor.js";

const leer = <T>(archivo: string): T => JSON.parse(readFileSync(new URL(`../../../../conformance/${archivo}`, import.meta.url), "utf8")) as T;
const describir = (r: Resultado): string => (r.estado === "rejected" ? `rejected:${r.razon}` : r.estado);
const sqlite = (): AlmacenSqlite => new AlmacenSqlite(abrirBase(":memory:"), "viaje-1");

describe("almacén SQLite: los vectores de operaciones llegan al estado esperado en todos los órdenes", () => {
  const { escenarios } = leer<{ escenarios: { nombre: string; ops: Operacion[]; ordenes: number[][]; resultados: string[]; esperado: Instantanea }[] }>("operaciones.json");
  for (const esc of escenarios) {
    it(esc.nombre, () => {
      for (const orden of esc.ordenes) {
        const almacen = sqlite();
        const motor = new MotorOperaciones(almacen);
        for (const i of orden) motor.aplicar(esc.ops[i] as Operacion, AUTOR);
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
      return describir(ingesta.procesar(ops[i] as Operacion, REMITENTE));
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
  }, 60_000);

  describe("recepción de lotes", () => {
    const recibir = (almacen: AlmacenMemoria | AlmacenSqlite, pasos: { ops: readonly Operacion[]; dispositivo: string; ahora: number }[]) => {
      let ahora = 0;
      const recepcion = new RecepcionDeOperaciones(almacen, () => ahora);
      const resultados = pasos.map((p) => {
        ahora = p.ahora;
        return recepcion.procesarLote(p.ops, remitenteDe(p.dispositivo));
      });
      return { resultados, estado: almacen.instantanea(), secuencias: almacen.secuencias() };
    };

    it("los escenarios de recepción dan lo esperado y lo mismo en los dos almacenes", () => {
      const { escenarios } = leer<{ escenarios: { nombre: string; dispositivo: string; ops: Operacion[]; lotes: { ahora: number; dispositivo?: string; ops: number[] }[] }[] }>("recepcion.json");
      for (const e of escenarios) {
        const pasos = e.lotes.map((l) => ({ ops: l.ops.map((i) => e.ops[i] as Operacion), dispositivo: l.dispositivo ?? e.dispositivo, ahora: l.ahora }));
        expect(recibir(sqlite(), pasos), e.nombre).toEqual(recibir(new AlmacenMemoria(), pasos));
      }
    });

    it("200 recorridos aleatorios con marcas del futuro, duplicados y dos dispositivos dan lo mismo en los dos almacenes", () => {
      const azar = generador(20261125);
      let corregidas = 0;
      let duplicadasConMarca = 0;
      for (let caso = 0; caso < 200; caso++) {
        const ops = generar(azar);
        // la mitad de las marcas se adelanta más de 5 minutos respecto de la hora del servidor (1000)
        const movidas = ops.map((o) => {
          const m = parsearHlc(o.hlc);
          if (!m.ok || azar() < 0.5) return o;
          return { ...o, hlc: formatearHlc({ ...m.hlc, ms: m.hlc.ms + 400_000 + Math.floor(azar() * 500_000) }) };
        });
        const llegada = conDuplicados(azar, caso % 2 === 0 ? [movidas[0] as Operacion, ...barajar(azar, movidas.slice(1))] : barajar(azar, movidas));
        const pasos = llegada.map((o) => {
          const m = parsearHlc(o.hlc);
          return { ops: [o], dispositivo: m.ok ? m.hlc.dispositivo : "", ahora: 1000 };
        });
        const enSqlite = sqlite();
        const resultado = recibir(enSqlite, pasos);
        expect(resultado, `caso ${caso}`).toEqual(recibir(new AlmacenMemoria(), pasos));
        resultado.resultados.forEach((lote, k) => {
          const r = lote[0];
          if (r === undefined || r.estado === "rejected") return;
          // la marca que se devuelve es la que quedó guardada, y la secuencia es la guardada
          expect(enSqlite.buscarOp(r.opId), `caso ${caso}`).toEqual({ seq: r.seq, hlc: r.hlc });
          const enviada = (pasos[k] as { ops: readonly Operacion[] }).ops[0] as Operacion;
          if (r.estado === "accepted" && r.hlc !== enviada.hlc) corregidas += 1;
          if (r.estado === "duplicate") duplicadasConMarca += 1;
        });
      }
      expect(corregidas).toBeGreaterThan(100); // la prueba sí ejercita la corrección
      expect(duplicadasConMarca).toBeGreaterThan(20);
    }, 60_000);
  });
});
