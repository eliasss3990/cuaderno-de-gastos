import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import type { Operacion } from "../../../src/dominio/operaciones/operaciones.js";
import { LoteInvalidoError, MAX_OPERACIONES_POR_LOTE, RecepcionDeOperaciones, type ResultadoDeOperacion } from "../../../src/dominio/operaciones/recepcion.js";
import { remitenteDe } from "../../ayudas/autor.js";

interface Lote { ahora: number; dispositivo?: string; ops: number[]; resultados: { estado: string; seq?: number; razon?: string; hlc: string }[] }
interface Escenario { nombre: string; dispositivo: string; ops: Operacion[]; lotes: Lote[] }
const { escenarios } = JSON.parse(readFileSync(new URL("../../../../conformance/recepcion.json", import.meta.url), "utf8")) as { escenarios: Escenario[] };

const sinVacios = (r: ResultadoDeOperacion) => Object.fromEntries(Object.entries({ estado: r.estado, seq: r.seq, razon: r.razon, hlc: r.hlc }).filter(([, v]) => v !== undefined));

describe("recepción de lotes: vectores de conformidad", () => {
  it("hay escenarios y los resultados están alineados", () => {
    expect(escenarios.length).toBeGreaterThanOrEqual(5);
    for (const e of escenarios) for (const l of e.lotes) expect(l.resultados).toHaveLength(l.ops.length);
  });
  for (const esc of escenarios) {
    it(esc.nombre, () => {
      const almacen = new AlmacenMemoria();
      let ahora = 0;
      const recepcion = new RecepcionDeOperaciones(almacen, () => ahora);
      for (const lote of esc.lotes) {
        ahora = lote.ahora;
        const obtenidos = recepcion.procesarLote(lote.ops.map((i) => esc.ops[i] as Operacion), remitenteDe(lote.dispositivo ?? esc.dispositivo));
        expect(obtenidos.map(sinVacios)).toEqual(lote.resultados);
        expect(obtenidos.map((r) => r.opId)).toEqual(lote.ops.map((i) => (esc.ops[i] as Operacion).opId));
      }
      const s = almacen.secuencias();
      expect(s).toEqual(s.map((_, i) => i + 1));
    });
  }
});

describe("recepción de lotes: forma del lote", () => {
  const D = "018f3a6e-0000-7000-8000-00000000000a";
  const recepcion = () => new RecepcionDeOperaciones(new AlmacenMemoria(), () => 1802000000000);
  it("un lote vacío, que no es lista o de más de 100 operaciones se rechaza entero", () => {
    expect(() => recepcion().procesarLote([], remitenteDe(D))).toThrow(LoteInvalidoError);
    expect(() => recepcion().procesarLote(null as unknown as Operacion[], remitenteDe(D))).toThrow(LoteInvalidoError);
    expect(() => recepcion().procesarLote(Array(101).fill({}) as Operacion[], remitenteDe(D))).toThrow(LoteInvalidoError);
    expect(MAX_OPERACIONES_POR_LOTE).toBe(100);
  });
  it("lo que no es una operación se rechaza por formato y no frena al resto", () => {
    const basura = [null, 5, "x", [], true, {}, { opId: 7, hlc: 9 }, { opId: "x", hlc: [`${(1802000000000).toString(16).padStart(13, "0")}-0000-${D}`] }] as unknown as Operacion[];
    const r = recepcion().procesarLote(basura, remitenteDe(D));
    expect(r).toHaveLength(basura.length);
    for (const x of r) expect(x).toMatchObject({ estado: "rejected", razon: "formato" });
    expect(r.map((x) => x.opId)).toEqual(["", "", "", "", "", "", "", "x"]);
    expect(r.map((x) => x.hlc)).toEqual(["", "", "", "", "", "", "", ""]);
  });
  it("el formato se mira antes que el duplicado: el mismo op_id con un contenido inválido es formato, no duplicado", () => {
    const almacen = new AlmacenMemoria();
    const r = new RecepcionDeOperaciones(almacen, () => 1802000000000);
    const viaje: Operacion = { schemaVersion: 1, opId: "018f3a6e-9000-7000-8000-000000000001", tipo: "trip.create", entidadTipo: "trip", entidadId: "018f3a6e-1000-7000-8000-000000000001", hlc: `${(1802000000000 - 1000).toString(16).padStart(13, "0")}-0000-${D}`, payload: { nombre: "Brasil", zona_horaria: "America/Asuncion", monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$" }] } };
    expect(r.procesarLote([viaje], remitenteDe(D))[0]).toMatchObject({ estado: "accepted", seq: 1 });
    const roto = { ...viaje, payload: { nombre: "" } } as Operacion;
    expect(r.procesarLote([roto], remitenteDe(D))[0]).toMatchObject({ estado: "rejected", razon: "formato" });
    expect(r.procesarLote([viaje], remitenteDe(D))[0]).toMatchObject({ estado: "duplicate", seq: 1 });
  });
  it("exactamente 100 operaciones se aceptan como lote", () => {
    const r = recepcion().procesarLote(Array(100).fill({}) as Operacion[], remitenteDe(D));
    expect(r).toHaveLength(100);
  });
});
