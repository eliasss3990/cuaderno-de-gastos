import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { ServicioDeSincronizacion } from "../../../src/dominio/operaciones/sincronizacion.js";
import { delViaje } from "../../../src/http/autenticacion.js";
import { ErrorDeServicio } from "../../../src/dominio/identidad/servicioIdentidad.js";

const DISP = "018f3a6e-0000-7000-8000-00000000000a";
const actor = { tripId: "t1", deviceId: DISP };
const marca = (n: number): string => `${(1000 + n).toString(16).padStart(13, "0")}-0000-${DISP}`;

function armar(): { servicio: ServicioDeSincronizacion; almacen: AlmacenMemoria } {
  const almacen = new AlmacenMemoria();
  return { almacen, servicio: new ServicioDeSincronizacion({ almacenDe: () => almacen, ahora: () => 5000 }) };
}

describe("delViaje", () => {
  it("sin dispositivo o con el de otro viaje es no_existe", () => {
    expect(() => delViaje("t1", null)).toThrow(expect.objectContaining({ codigo: "no_existe" }));
    expect(() => delViaje("t1", { tripId: "t2" })).toThrow(expect.objectContaining({ codigo: "no_existe" }));
    expect(delViaje("t1", { tripId: "t1" })).toEqual({ tripId: "t1" });
  });
});

describe("ServicioDeSincronizacion", () => {
  it("un lote vacío o de más de 100 es formato_invalido", () => {
    const { servicio } = armar();
    expect(() => servicio.subir(actor, [])).toThrow(ErrorDeServicio);
    expect(() => servicio.subir(actor, new Array(101).fill({}))).toThrow(expect.objectContaining({ codigo: "formato_invalido" }));
  });

  it("subir rechaza lo que no tiene formato sin frenar al resto, y no consume secuencia", () => {
    const { servicio, almacen } = armar();
    const r = servicio.subir(actor, [null, { opId: "x" }]);
    expect(r.map((x) => x.estado)).toEqual(["rejected", "rejected"]);
    expect(almacen.seqMaximo()).toBe(0);
  });

  it("bajar sobre un viaje sin operaciones devuelve página vacía con la cabeza en 0", () => {
    const { servicio } = armar();
    expect(servicio.bajar(actor, 0, 200)).toEqual({ ops: [], siguiente: 0, hayMas: false, cabeza: 0 });
    expect(servicio.cabeza(actor)).toBe(0);
  });

  it("bajar pagina: siguiente es la última secuencia devuelta y hayMas avisa si queda algo", () => {
    const { servicio, almacen } = armar();
    for (let i = 1; i <= 5; i++) almacen.guardarOp({ opId: `o${i}`, tipo: "expense.update", entidadTipo: "expense", entidadId: "e", hlc: marca(i), payload: { n: i }, redactada: false, padreId: null });
    const p1 = servicio.bajar(actor, 0, 2);
    expect([p1.ops.map((o) => o.seq), p1.siguiente, p1.hayMas, p1.cabeza]).toEqual([[1, 2], 2, true, 5]);
    const p2 = servicio.bajar(actor, p1.siguiente, 10);
    expect([p2.ops.map((o) => o.seq), p2.siguiente, p2.hayMas]).toEqual([[3, 4, 5], 5, false]);
    expect(servicio.bajar(actor, 5, 10)).toMatchObject({ ops: [], siguiente: 5, hayMas: false });
  });

  it("un after mayor que la cabeza no adelanta el cursor: next es la cabeza", () => {
    const { servicio, almacen } = armar();
    almacen.guardarOp({ opId: "o1", tipo: "expense.update", entidadTipo: "expense", entidadId: "e", hlc: marca(1), payload: {}, redactada: false, padreId: null });
    expect(servicio.bajar(actor, 999999999999999, 10)).toEqual({ ops: [], siguiente: 1, hayMas: false, cabeza: 1 });
  });

  it("una página nunca pasa de 200 operaciones aunque se pida más", () => {
    const { servicio, almacen } = armar();
    for (let i = 1; i <= 201; i++) almacen.guardarOp({ opId: `o${i}`, tipo: "expense.update", entidadTipo: "expense", entidadId: "e", hlc: marca(i), payload: {}, redactada: false, padreId: null });
    expect(servicio.bajar(actor, 0, 500)).toMatchObject({ siguiente: 200, hayMas: true, cabeza: 201 });
    expect(servicio.bajar(actor, 0, 500).ops).toHaveLength(200);
  });

  it("el tope de la página se limita a 200 y a por lo menos 1", () => {
    const { servicio, almacen } = armar();
    for (let i = 1; i <= 3; i++) almacen.guardarOp({ opId: `o${i}`, tipo: "expense.update", entidadTipo: "expense", entidadId: "e", hlc: marca(i), payload: {}, redactada: false, padreId: null });
    expect(servicio.bajar(actor, 0, 0).ops).toHaveLength(1);
    expect(servicio.bajar(actor, 0, 99999).ops).toHaveLength(3);
  });
});
