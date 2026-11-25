import { describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../../src/almacen/operaciones/almacenSqlite.js";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import type { Almacen, OpGuardada } from "../../../src/dominio/operaciones/operaciones.js";
import { SOBRE_GUARDADO } from "../../ayudas/autor.js";

const MARCA_1 = "0000000000064-0000-018f3a6e-0000-7000-8000-00000000000a";
const MARCA_2 = "00000000000c8-0000-018f3a6e-0000-7000-8000-00000000000a";

// Cada operación lleva su propia marca (la marca es única por operación), salvo que el test pida una.
const marcasPorOp = new Map<string, string>();
function marcaPropia(opId: string): string {
  let m = marcasPorOp.get(opId);
  if (m === undefined) {
    m = `${(1000 + marcasPorOp.size).toString(16).padStart(13, "0")}-0000-018f3a6e-0000-7000-8000-00000000000a`;
    marcasPorOp.set(opId, m);
  }
  return m;
}

function op(opId: string, extra: Partial<OpGuardada> = {}): OpGuardada {
  return { opId, tipo: "expense.update", entidadTipo: "expense", entidadId: "e1", hlc: marcaPropia(opId), payload: { concepto: "x" }, redactada: false, padreId: null, ...SOBRE_GUARDADO, ...extra };
}

// Contrato que debe cumplir cualquier almacén: el de memoria y el de SQLite pasan exactamente las mismas pruebas.
describe.each<[string, () => Almacen]>([
  ["memoria", () => new AlmacenMemoria()],
  ["sqlite", () => new AlmacenSqlite(abrirBase(":memory:"), "viaje-1")],
])("contrato del almacén: %s", (_nombre, crear) => {
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

  it("leerCampo devuelve el valor actual y undefined si no hay entidad o campo", () => {
    const a = crear();
    expect(a.leerCampo("expense", "e1", "nota")).toBeUndefined();
    a.crearEntidad("expense", "e1");
    expect(a.leerCampo("expense", "e1", "nota")).toBeUndefined();
    a.escribirCampo("expense", "e1", "nota", "a", MARCA_1);
    a.escribirCampo("expense", "e1", "vacio", null, MARCA_1);
    expect(a.leerCampo("expense", "e1", "nota")).toBe("a");
    expect(a.leerCampo("expense", "e1", "vacio")).toBeNull();
    a.terminar("expense", "e1");
    expect(a.leerCampo("expense", "e1", "nota")).toBeUndefined();
  });

  it("contarEntidades cuenta las del tipo y no cuenta las terminadas", () => {
    const a = crear();
    expect(a.contarEntidades("shortcut")).toBe(0);
    for (const id of ["s1", "s2", "s3"]) a.crearEntidad("shortcut", id);
    a.crearEntidad("expense", "e1");
    expect(a.contarEntidades("shortcut")).toBe(3);
    a.terminar("shortcut", "s2");
    expect(a.contarEntidades("shortcut")).toBe(2);
    expect(a.contarEntidades("expense")).toBe(1);
  });

  it("no se guarda dos veces la misma operación ni dos operaciones con la misma marca, y no queda nada a medias", () => {
    const a = crear();
    a.guardarOp(op("o1", { hlc: MARCA_1 }));
    expect(() => a.guardarOp(op("o1", { hlc: MARCA_2 }))).toThrow();
    expect(() => a.guardarOp(op("o2", { hlc: MARCA_1 }))).toThrow();
    expect(a.opConocida("o2")).toBe(false);
    expect(a.marcaEnUso(MARCA_2)).toBe(false);
    expect(a.guardarOp(op("o3", { hlc: MARCA_2 }))).toBe(2); // la secuencia no se movió por los intentos fallidos
  });

  it("escribir un campo de una entidad que no existe falla con un error claro", () => {
    expect(() => crear().escribirCampo("expense", "nada", "nota", "x", MARCA_1)).toThrow(/no existe/);
  });

  it("padreRegistrado devuelve el primer padre registrado y se salta las operaciones sin padre", () => {
    const a = crear();
    expect(a.padreRegistrado("attachment", "a1")).toBeNull();
    a.guardarOp(op("o0", { entidadTipo: "attachment", entidadId: "a1", padreId: null }));
    expect(a.padreRegistrado("attachment", "a1")).toBeNull();
    a.guardarOp(op("o1", { entidadTipo: "attachment", entidadId: "a1", padreId: "p1" }));
    a.guardarOp(op("o2", { entidadTipo: "attachment", entidadId: "a1", padreId: "p2" }));
    expect(a.padreRegistrado("attachment", "a1")).toBe("p1");
    expect(a.padreRegistrado("attachment", "otro")).toBeNull();
  });

  it("una transacción dentro de otra forma parte de ella: si la interna falla y la externa lo captura, lo escrito se conserva", () => {
    const a = crear();
    a.transaccion(() => {
      try {
        a.transaccion(() => {
          a.crearEntidad("expense", "e2");
          throw new Error("falla interna");
        });
      } catch {
        // la externa decide seguir
      }
      a.crearEntidad("expense", "e3");
    });
    expect(a.entidadExiste("expense", "e2")).toBe(true);
    expect(a.entidadExiste("expense", "e3")).toBe(true);
  });

  it("buscarOp devuelve la secuencia y la marca guardadas, y null si no se guardó", () => {
    const a = crear();
    expect(a.buscarOp("o1")).toBeNull();
    a.guardarOp(op("o1", { hlc: MARCA_1 }));
    a.guardarOp(op("o2", { hlc: MARCA_2 }));
    expect(a.buscarOp("o1")).toEqual({ seq: 1, hlc: MARCA_1 });
    expect(a.buscarOp("o2")).toEqual({ seq: 2, hlc: MARCA_2 });
    expect(a.buscarOp("o3")).toBeNull();
  });

  it("guarda y devuelve la versión, el autor y la hora de cada operación, y la instantánea los deja afuera", () => {
    const a = crear();
    a.guardarOp(op("o1", { schemaVersion: 1, deviceId: "dev-a", memberId: "mem-a", aceptadaEn: 1802000000123 }));
    a.guardarOp(op("o2", { schemaVersion: 2, deviceId: "dev-b", memberId: "mem-b", aceptadaEn: 7 }));
    expect(a.leerOps(0, 10).map((o) => [o.opId, o.schemaVersion, o.deviceId, o.memberId, o.aceptadaEn])).toEqual([
      ["o1", 1, "dev-a", "mem-a", 1802000000123],
      ["o2", 2, "dev-b", "mem-b", 7],
    ]);
    const enEstado = (a as unknown as { instantanea(): { ops: object[] } }).instantanea().ops[0];
    expect(enEstado).not.toHaveProperty("deviceId");
    expect(enEstado).not.toHaveProperty("memberId");
    expect(enEstado).not.toHaveProperty("aceptadaEn");
    expect(enEstado).not.toHaveProperty("schemaVersion");
  });

  it("leerOps devuelve las operaciones después de una secuencia, en orden, con tope, y seqMaximo da la última", () => {
    const a = crear();
    expect(a.seqMaximo()).toBe(0);
    expect(a.leerOps(0, 10)).toEqual([]);
    for (const id of ["o1", "o2", "o3", "o4"]) a.guardarOp(op(id));
    expect(a.seqMaximo()).toBe(4);
    expect(a.leerOps(0, 10).map((o) => [o.opId, o.seq])).toEqual([["o1", 1], ["o2", 2], ["o3", 3], ["o4", 4]]);
    expect(a.leerOps(1, 2).map((o) => o.opId)).toEqual(["o2", "o3"]);
    expect(a.leerOps(4, 10)).toEqual([]);
    expect(a.leerOps(0, 10)[0]).toMatchObject({ tipo: "expense.update", entidadTipo: "expense", entidadId: "e1", payload: { concepto: "x" }, redactada: false, padreId: null });
  });

  it("leerOps muestra las redactadas sin payload y no deja modificar lo guardado", () => {
    const a = crear();
    a.guardarOp(op("o1"));
    a.redactarPorEntidad("expense", "e1");
    const [leida] = a.leerOps(0, 10);
    expect(leida).toMatchObject({ opId: "o1", payload: null, redactada: true });
    a.guardarOp(op("o2", { payload: { concepto: "y" } }));
    (a.leerOps(1, 10)[0]?.payload as { concepto: string }).concepto = "cambiado";
    expect(a.leerOps(1, 10)[0]?.payload).toEqual({ concepto: "y" });
  });

  it("ultimaMarcaDe devuelve la mayor marca de ese dispositivo y null si no tiene", () => {
    const a = crear();
    const otro = "018f3a6e-0000-7000-8000-00000000000b";
    const marca = (ms: number, contador: number, dispositivo: string) => `${ms.toString(16).padStart(13, "0")}-${contador.toString(16).padStart(4, "0")}-${dispositivo}`;
    const mia = "018f3a6e-0000-7000-8000-00000000000a";
    expect(a.ultimaMarcaDe(mia)).toBeNull();
    a.guardarOp(op("o1", { hlc: marca(100, 5, mia) }));
    a.guardarOp(op("o2", { hlc: marca(300, 0, mia) }));
    a.guardarOp(op("o3", { hlc: marca(200, 9, mia) }));
    a.guardarOp(op("o4", { hlc: marca(900, 0, otro) }));
    a.guardarOp(op("o5", { hlc: marca(300, 1, mia) }));
    expect(a.ultimaMarcaDe(mia)).toBe(marca(300, 1, mia));
    expect(a.ultimaMarcaDe(otro)).toBe(marca(900, 0, otro));
    expect(a.ultimaMarcaDe("018f3a6e-0000-7000-8000-00000000000c")).toBeNull();
  });

  it("idDelViaje devuelve el id del viaje o null", () => {
    const a = crear();
    expect(a.idDelViaje()).toBeNull();
    a.crearEntidad("expense", "e1");
    expect(a.idDelViaje()).toBeNull();
    a.crearEntidad("trip", "v1");
    expect(a.idDelViaje()).toBe("v1");
  });

  it("intervalos de cierre: abrir, cerrar y consultar en orden", () => {
    const a = crear();
    expect(a.intervalosDeCierre()).toEqual([]);
    a.abrirIntervalo(100, "MANUAL");
    expect(a.intervalosDeCierre()).toEqual([{ desdeMs: 100, hastaMs: null, causa: "MANUAL" }]);
    a.cerrarIntervalo(200);
    a.abrirIntervalo(200, "FECHAS");
    a.cerrarIntervalo(300);
    expect(a.intervalosDeCierre()).toEqual([
      { desdeMs: 100, hastaMs: 200, causa: "MANUAL" },
      { desdeMs: 200, hastaMs: 300, causa: "FECHAS" },
    ]);
  });

  it("intervalos de cierre: rechaza superposiciones, dos abiertos y cierres sin sentido", () => {
    const a = crear();
    expect(() => a.cerrarIntervalo(10)).toThrow();
    a.abrirIntervalo(100, "MANUAL");
    expect(() => a.abrirIntervalo(150, "FECHAS")).toThrow();
    expect(() => a.cerrarIntervalo(100)).toThrow(/posterior/);
    expect(() => a.cerrarIntervalo(99)).toThrow(/posterior/);
    a.cerrarIntervalo(200);
    expect(() => a.cerrarIntervalo(300)).toThrow();
    expect(() => a.abrirIntervalo(199, "FECHAS")).toThrow();
    a.abrirIntervalo(200, "FECHAS");
    a.cerrarIntervalo(300);
    // con varios guardados se compara con el último, no con el primero
    expect(() => a.abrirIntervalo(250, "MANUAL")).toThrow(/superpone/);
    expect(() => a.abrirIntervalo(299, "MANUAL")).toThrow(/superpone/);
    a.abrirIntervalo(300, "MANUAL");
  });

  it("intervalos de cierre: la lista devuelta no deja modificar el almacén", () => {
    const a = crear();
    a.abrirIntervalo(100, "MANUAL");
    const lista = a.intervalosDeCierre() as unknown as { hastaMs: number | null }[];
    (lista[0] as { hastaMs: number | null }).hastaMs = 5;
    expect(a.intervalosDeCierre()[0]?.hastaMs).toBeNull();
  });

  it("intervalos de cierre: una transacción que falla los deshace", () => {
    const a = crear();
    a.abrirIntervalo(100, "MANUAL");
    expect(() =>
      a.transaccion(() => {
        a.cerrarIntervalo(200);
        a.abrirIntervalo(300, "FECHAS");
        throw new Error("falla");
      }),
    ).toThrow("falla");
    expect(a.intervalosDeCierre()).toEqual([{ desdeMs: 100, hastaMs: null, causa: "MANUAL" }]);
  });
});
