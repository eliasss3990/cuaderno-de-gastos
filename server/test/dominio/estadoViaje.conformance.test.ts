import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cierrePorFechas, diaSiguiente, estadoDelViaje, inicioDelDia, type PlanDelViaje } from "../../src/dominio/estadoViaje.js";

interface Vectores {
  inicios: { fecha: string; zona: string; ms: number }[];
  estados: { nombre: string; estadoManual: PlanDelViaje["estadoManual"]; fechaInicio: string | null; fechaFin: string | null; zonaHoraria: string; ahora: number; esperado: string }[];
}
const v = JSON.parse(readFileSync(new URL("../../../conformance/estado_viaje.json", import.meta.url), "utf8")) as Vectores;

describe("estado del viaje: vectores de conformidad", () => {
  it("hay vectores", () => {
    expect(v.inicios.length).toBeGreaterThanOrEqual(14);
    expect(v.estados.length).toBeGreaterThanOrEqual(14);
  });
  for (const c of v.inicios) {
    it(`inicio del ${c.fecha} en ${c.zona}`, () => expect(inicioDelDia(c.fecha, c.zona)).toBe(c.ms));
  }
  for (const c of v.estados) {
    it(c.nombre, () => {
      const { ahora, esperado, nombre: _n, ...plan } = c;
      expect(estadoDelViaje(plan, ahora)).toBe(esperado);
    });
  }
});

describe("estado del viaje: propiedades", () => {
  it("el cierre por fechas es el inicio del día siguiente y no hay cierre sin fecha de fin", () => {
    expect(cierrePorFechas({ fechaFin: null, zonaHoraria: "America/Asuncion" })).toBeNull();
    expect(cierrePorFechas({ fechaFin: "2027-02-18", zonaHoraria: "America/Asuncion" })).toBe(inicioDelDia("2027-02-19", "America/Asuncion"));
  });
  it("diaSiguiente respeta fines de mes, de año y bisiestos", () => {
    expect([diaSiguiente("2027-02-28"), diaSiguiente("2028-02-28"), diaSiguiente("2028-02-29"), diaSiguiente("2027-12-31")]).toEqual(["2027-03-01", "2028-02-29", "2028-03-01", "2028-01-01"]);
  });
  it("fechas inválidas lanzan error", () => {
    for (const f of ["", "2027-2-1", "hoy", "2027-02-30x"]) expect(() => inicioDelDia(f, "America/Asuncion")).toThrow(RangeError);
    expect(() => diaSiguiente("x")).toThrow(RangeError);
  });
  it("los inicios de días consecutivos crecen y distan entre 23 y 25 horas, en varias zonas", () => {
    for (const zona of ["America/New_York", "Europe/Madrid", "America/Havana", "Pacific/Auckland", "America/Asuncion"]) {
      let fecha = "2027-01-01";
      let anterior = inicioDelDia(fecha, zona);
      for (let i = 0; i < 400; i++) {
        fecha = diaSiguiente(fecha);
        const actual = inicioDelDia(fecha, zona);
        expect(actual - anterior, `${zona} ${fecha}`).toBeGreaterThanOrEqual(23 * 3600000);
        expect(actual - anterior, `${zona} ${fecha}`).toBeLessThanOrEqual(25 * 3600000);
        anterior = actual;
      }
    }
  });
  it("el estado por fechas nunca retrocede con el tiempo (planificado, en curso, cerrado)", () => {
    const orden = { PLANIFICADO: 0, EN_CURSO: 1, CERRADO: 2 } as const;
    const plan: PlanDelViaje = { estadoManual: null, fechaInicio: "2027-03-10", fechaFin: "2027-03-20", zonaHoraria: "America/New_York" };
    let previo = 0;
    for (let ms = inicioDelDia("2027-03-08", "America/New_York"); ms < inicioDelDia("2027-03-23", "America/New_York"); ms += 3_600_000) {
      const o = orden[estadoDelViaje(plan, ms)];
      expect(o).toBeGreaterThanOrEqual(previo);
      previo = o;
    }
    expect(previo).toBe(2);
  });
});
