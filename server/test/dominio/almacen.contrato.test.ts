import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../src/dominio/almacenMemoria.js";
import type { Almacen, OpGuardada } from "../../src/dominio/operaciones.js";

const MARCA_1 = "0000000000064-0000-018f3a6e-0000-7000-8000-00000000000a";
const MARCA_2 = "00000000000c8-0000-018f3a6e-0000-7000-8000-00000000000a";

function op(opId: string, extra: Partial<OpGuardada> = {}): OpGuardada {
  return { opId, tipo: "expense.update", entidadTipo: "expense", entidadId: "e1", hlc: MARCA_1, payload: { concepto: "x" }, redactada: false, padreId: null, ...extra };
}

// Contrato que debe cumplir cualquier almacén: hoy el de memoria; el de SQLite se agrega a esta lista.
describe.each<[string, () => Almacen]>([["memoria", () => new AlmacenMemoria()]])("contrato del almacén: %s", (_nombre, crear) => {
  it("crear una entidad es idempotente y no borra lo escrito", () => {
    const a = crear();
    expect(a.entidadExiste("expense", "e1")).toBe(false);
    a.crearEntidad("expense", "e1");
    a.escribirCampo("expense", "e1", "concepto", "x", MARCA_1);
    a.crearEntidad("expense", "e1");
    expect(a.entidadExiste("expense", "e1")).toBe(true);
    expect(a.leerReloj("expense", "e1", "concepto")).toBe(MARCA_1);
  });

  it("un campo sin escribir no tiene reloj, y escribir lo actualiza", () => {
    const a = crear();
    a.crearEntidad("expense", "e1");
    expect(a.leerReloj("expense", "e1", "nota")).toBeNull();
    a.escribirCampo("expense", "e1", "nota", "a", MARCA_1);
    a.escribirCampo("expense", "e1", "nota", "b", MARCA_2);
    expect(a.leerReloj("expense", "e1", "nota")).toBe(MARCA_2);
  });

  it("terminar borra la entidad y deja la lápida, también si nunca existió", () => {
    const a = crear();
    a.crearEntidad("expense", "e1");
    a.escribirCampo("expense", "e1", "nota", "a", MARCA_1);
    a.terminar("expense", "e1");
    expect(a.entidadExiste("expense", "e1")).toBe(false);
    expect(a.entidadTerminada("expense", "e1")).toBe(true);
    expect(a.leerReloj("expense", "e1", "nota")).toBeNull();
    a.terminar("attachment", "nunca-existio");
    expect(a.entidadTerminada("attachment", "nunca-existio")).toBe(true);
    expect(a.entidadExiste("attachment", "nunca-existio")).toBe(false);
  });

  it("la secuencia empieza en 1, crece de a uno y se reconoce la operación guardada", () => {
    const a = crear();
    expect(a.opConocida("o1")).toBe(false);
    expect(a.guardarOp(op("o1"))).toBe(1);
    expect(a.guardarOp(op("o2"))).toBe(2);
    expect(a.opConocida("o1")).toBe(true);
    expect(a.opConocida("o3")).toBe(false);
  });

  it("redactar por entidad solo toca las operaciones de esa entidad", () => {
    const a = crear();
    a.guardarOp(op("o1"));
    a.guardarOp(op("o2", { entidadId: "e2" }));
    a.redactarPorEntidad("expense", "e1");
    const m = new Map(((a as AlmacenMemoria).instantanea().ops).map((o) => [o.opId, o]));
    expect(m.get("o1")).toMatchObject({ redactada: true, payload: null });
    expect(m.get("o2")).toMatchObject({ redactada: false, payload: { concepto: "x" } });
  });

  it("redactar por padre alcanza a las operaciones de los hijos y el padre registrado sobrevive", () => {
    const a = crear();
    a.guardarOp(op("o1", { tipo: "attachment.add", entidadTipo: "attachment", entidadId: "a1", padreId: "e1", payload: { mime: "x" } }));
    a.guardarOp(op("o2", { tipo: "attachment.add", entidadTipo: "attachment", entidadId: "a2", padreId: "e2", payload: { mime: "y" } }));
    a.redactarPorPadre("e1");
    expect(a.padreRegistrado("attachment", "a1")).toBe("e1");
    expect(a.padreRegistrado("attachment", "a3")).toBeNull();
    const m = new Map(((a as AlmacenMemoria).instantanea().ops).map((o) => [o.opId, o]));
    expect(m.get("o1")).toMatchObject({ redactada: true, payload: null });
    expect(m.get("o2")).toMatchObject({ redactada: false });
  });

  it("los adjuntos de un dueño incluyen los quitados y excluyen los de otros", () => {
    const a = crear();
    for (const [adj, dueno] of [["a1", "e1"], ["a2", "e1"], ["a3", "e2"]] as const) {
      a.crearEntidad("attachment", adj);
      a.escribirCampo("attachment", adj, "owner_id", dueno, MARCA_1);
    }
    a.escribirCampo("attachment", "a2", "quitado", 1, MARCA_2);
    expect(a.adjuntosDe("e1").sort()).toEqual(["a1", "a2"]);
    expect(a.adjuntosDe("e2")).toEqual(["a3"]);
    expect(a.adjuntosDe("e9")).toEqual([]);
  });

  it("una transacción que lanza un error deshace todo lo escrito dentro", () => {
    const a = crear() as AlmacenMemoria;
    a.crearEntidad("expense", "e0");
    a.escribirCampo("expense", "e0", "nota", "a", MARCA_1);
    a.guardarOp(op("o0", { entidadId: "e0", hlc: MARCA_1 }));
    const antes = a.instantanea();
    expect(() =>
      a.transaccion(() => {
        a.crearEntidad("expense", "e1");
        a.escribirCampo("expense", "e1", "nota", "x", MARCA_2);
        a.escribirCampo("expense", "e0", "nota", "b", MARCA_2);
        a.escribirCampo("expense", "e0", "lugar", "l", MARCA_2);
        a.guardarOp(op("o1", { entidadId: "e0", hlc: MARCA_2 }));
        a.redactarPorEntidad("expense", "e0");
        a.terminar("expense", "e0");
        throw new Error("falla");
      }),
    ).toThrow("falla");
    expect(a.instantanea()).toEqual(antes);
    expect(a.marcaEnUso(MARCA_2)).toBe(false);
    expect(a.guardarOp(op("o2", { hlc: MARCA_2 }))).toBe(2); // la secuencia vuelve a donde estaba
  });

  it("una transacción que termina bien conserva lo escrito y devuelve el resultado", () => {
    const a = crear();
    const r = a.transaccion(() => {
      a.crearEntidad("expense", "e1");
      return a.guardarOp(op("o1"));
    });
    expect(r).toBe(1);
    expect(a.entidadExiste("expense", "e1")).toBe(true);
    expect(a.opConocida("o1")).toBe(true);
  });

  it("una transacción anidada forma parte de la externa: si la externa falla, se deshace todo", () => {
    const a = crear();
    expect(() =>
      a.transaccion(() => {
        a.transaccion(() => a.crearEntidad("expense", "e1"));
        throw new Error("falla");
      }),
    ).toThrow("falla");
    expect(a.entidadExiste("expense", "e1")).toBe(false);
  });

  it("las marcas en uso incluyen las de las operaciones redactadas", () => {
    const a = crear();
    expect(a.marcaEnUso(MARCA_1)).toBe(false);
    a.guardarOp(op("o1", { hlc: MARCA_1 }));
    expect(a.marcaEnUso(MARCA_1)).toBe(true);
    a.redactarPorEntidad("expense", "e1");
    expect(a.marcaEnUso(MARCA_1)).toBe(true);
    expect(a.marcaEnUso(MARCA_2)).toBe(false);
  });

  it("los adjuntos de un dueño salen ordenados por identificador", () => {
    const a = crear();
    for (const adj of ["a3", "a1", "a2"]) {
      a.crearEntidad("attachment", adj);
      a.escribirCampo("attachment", adj, "owner_id", "e1", MARCA_1);
    }
    expect(a.adjuntosDe("e1")).toEqual(["a1", "a2", "a3"]);
  });

  it("la transacción deshace en orden inverso: crear y terminar dentro de ella no deja ni entidad ni lápida", () => {
    const a = crear();
    expect(() =>
      a.transaccion(() => {
        a.crearEntidad("expense", "e1");
        a.terminar("expense", "e1");
        throw new Error("falla");
      }),
    ).toThrow("falla");
    expect(a.entidadExiste("expense", "e1")).toBe(false);
    expect(a.entidadTerminada("expense", "e1")).toBe(false);
  });

  it("terminar algo ya terminado dentro de una transacción que falla conserva la lápida", () => {
    const a = crear();
    a.crearEntidad("expense", "e1");
    a.terminar("expense", "e1");
    expect(() =>
      a.transaccion(() => {
        a.terminar("expense", "e1");
        throw new Error("falla");
      }),
    ).toThrow("falla");
    expect(a.entidadTerminada("expense", "e1")).toBe(true);
  });

  it("el almacén guarda copias: cambiar después lo que se le pasó no cambia lo guardado", () => {
    const a = crear() as AlmacenMemoria;
    const valor = { lista: [1, 2] };
    const payload = { concepto: "x", detalle: { n: 1 } };
    a.crearEntidad("expense", "e1");
    a.escribirCampo("expense", "e1", "extra", valor, MARCA_1);
    a.guardarOp(op("o1", { payload }));
    const antes = JSON.stringify(a.instantanea());
    valor.lista.push(3);
    payload.detalle.n = 99;
    expect(JSON.stringify(a.instantanea())).toBe(antes);
  });
});
