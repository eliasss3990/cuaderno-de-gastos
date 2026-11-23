import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../src/dominio/almacenMemoria.js";
import { Ingesta } from "../../src/dominio/ingesta.js";
import type { Operacion } from "../../src/dominio/operaciones.js";
import { barajar, conDuplicados, DINERO, generador, generar } from "../ayudas/operacionesAleatorias.js";

describe("ingesta de operaciones: las invariantes del modelo se cumplen siempre", () => {
  const azar = generador(20261123);

  it("tras cualquier orden de llegada: referencias que existen, límites y movimientos coherentes", () => {
    for (let caso = 0; caso < 200; caso++) {
      const ops = generar(azar);
      const primero = ops[0] as Operacion;
      const resto = barajar(azar, ops.slice(1));
      const orden = conDuplicados(azar, caso % 2 === 0 ? [primero, ...resto] : barajar(azar, ops));

      const almacen = new AlmacenMemoria();
      const ingesta = new Ingesta(almacen);
      const vistas = new Set<string>();
      let aceptadas = 0;
      for (const o of orden) {
        const r = ingesta.procesar(o);
        if (vistas.has(o.opId)) expect(r.estado).toBe("duplicate");
        if (r.estado === "accepted") aceptadas += 1;
        // si se aceptó, no pudo ser un duplicado; las razones posibles son las del plan
        if (r.estado === "rejected") expect(["formato", "entidad_inexistente", "moneda_no_habilitada", "limite_superado"]).toContain(r.razon);
        if (r.estado !== "rejected") vistas.add(o.opId);
      }
      expect(almacen.secuencias()).toEqual(Array.from({ length: aceptadas }, (_, i) => i + 1));

      const { entidades } = almacen.instantanea();
      const de = (tipo: string) => entidades.filter((e) => e.tipo === tipo);
      const monedas = new Set(de("trip_currency").map((e) => e.id));
      const categorias = new Set(de("category").map((e) => e.id));

      for (const e of [...de("expense"), ...de("fixed_cost"), ...de("shortcut")]) {
        if (e.campos.moneda !== undefined) expect(monedas.has(e.campos.moneda as string), `${e.tipo} con una moneda que el viaje no tiene`).toBe(true);
      }
      for (const e of [...de("expense"), ...de("shortcut")]) {
        if (e.campos.categoria_id !== undefined) expect(categorias.has(e.campos.categoria_id as string), `${e.tipo} con una categoría que no existe`).toBe(true);
      }
      expect(de("shortcut").length).toBeLessThanOrEqual(6);
      const activosPorDueno = new Map<string, number>();
      for (const a of de("attachment")) {
        if (a.campos.quitado === 1) continue;
        const dueno = a.campos.owner_id as string;
        activosPorDueno.set(dueno, (activosPorDueno.get(dueno) ?? 0) + 1);
      }
      for (const [dueno, cantidad] of activosPorDueno) expect(cantidad, `adjuntos activos de ${dueno}`).toBeLessThanOrEqual(3);

      for (const m of de("cash_movement")) {
        const tipo = m.campos.tipo as string;
        for (const campo of ["moneda_sale", "moneda_entra", "moneda_ajuste"]) {
          if (m.campos[campo] !== undefined) expect(monedas.has(m.campos[campo] as string)).toBe(true);
        }
        for (const campo of Object.keys(m.campos)) {
          if (!["tipo", "cuando", "nota"].includes(campo)) expect(DINERO[tipo], `campo ${campo} en un ${tipo}`).toContain(campo);
        }
        if (tipo === "CAMBIO") expect(m.campos.moneda_sale, "un cambio con las dos monedas iguales").not.toBe(m.campos.moneda_entra);
      }
    }
  });

  it("algo que ni siquiera es un objeto se rechaza por formato sin romper nada", () => {
    const almacen = new AlmacenMemoria();
    const ingesta = new Ingesta(almacen);
    for (const basura of [null, undefined, 5, "texto", true, [], [1, 2]]) {
      expect(ingesta.procesar(basura as unknown as Operacion)).toEqual({ estado: "rejected", razon: "formato" });
    }
    expect(almacen.secuencias()).toEqual([]);
  });
});
