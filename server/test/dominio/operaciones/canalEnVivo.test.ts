import { describe, expect, it } from "vitest";
import { CanalEnMemoria, MAX_CONEXIONES, type ReceptorDelCanal } from "../../../src/dominio/operaciones/canalEnVivo.js";

function receptor(nombre: string, registro: string[]): ReceptorDelCanal {
  return { novedades: (c) => registro.push(`${nombre}:${c}`), cerrar: () => registro.push(`${nombre}:cerrado`) };
}

describe("CanalEnMemoria", () => {
  it("avisa solo a los dispositivos del viaje", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    c.suscribir("t1", "a", receptor("a", r));
    c.suscribir("t1", "b", receptor("b", r));
    c.suscribir("t2", "c", receptor("c", r));
    c.notificar("t1", 7);
    expect(r.sort()).toEqual(["a:7", "b:7"]);
    expect(c.conexiones()).toBe(3);
  });

  it("una conexión nueva del mismo dispositivo cierra a la vieja y la baja de la vieja no toca a la nueva", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    const bajaVieja = c.suscribir("t1", "a", receptor("vieja", r));
    c.suscribir("t1", "a", receptor("nueva", r));
    expect(r).toEqual(["vieja:cerrado"]);
    bajaVieja();
    expect(c.conexiones()).toBe(1);
    c.notificar("t1", 3);
    expect(r).toEqual(["vieja:cerrado", "nueva:3"]);
  });

  it("dar de baja una conexión la saca, y hacerlo dos veces no molesta", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    const baja = c.suscribir("t1", "a", receptor("a", r));
    baja();
    baja();
    c.notificar("t1", 1);
    expect(r).toEqual([]);
    expect(c.conexiones()).toBe(0);
  });

  it("un receptor que falla no frena el aviso a los demás ni al cerrar", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    c.suscribir("t1", "a", { novedades: () => { throw new Error("roto"); }, cerrar: () => { throw new Error("roto"); } });
    c.suscribir("t1", "b", receptor("b", r));
    expect(() => c.notificar("t1", 4)).not.toThrow();
    expect(r).toEqual(["b:4"]);
    expect(() => c.cerrarTodo()).not.toThrow();
    expect(r).toEqual(["b:4", "b:cerrado"]);
  });

  it("cerrarTodo cierra a todos y deja el canal vacío", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    c.suscribir("t1", "a", receptor("a", r));
    c.suscribir("t2", "b", receptor("b", r));
    c.cerrarTodo();
    expect(r.sort()).toEqual(["a:cerrado", "b:cerrado"]);
    expect(c.conexiones()).toBe(0);
  });

  it("un receptor anterior que falla al cerrarse no impide la conexión nueva", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    c.suscribir("t1", "a", { novedades: () => {}, cerrar: () => { throw new Error("roto"); } });
    expect(() => c.suscribir("t1", "a", receptor("nueva", r))).not.toThrow();
    c.notificar("t1", 2);
    expect(r).toEqual(["nueva:2"]);
  });

  it("expulsar cierra solo la conexión de ese dispositivo y la saca; si no hay, no hace nada", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    c.suscribir("t1", "a", receptor("a", r));
    c.suscribir("t1", "b", receptor("b", r));
    c.expulsar("t1", "a");
    c.expulsar("t1", "a");
    c.expulsar("t2", "b");
    expect(r).toEqual(["a:cerrado"]);
    expect(c.conexiones()).toBe(1);
    c.notificar("t1", 1);
    expect(r).toEqual(["a:cerrado", "b:1"]);
  });

  it("expulsar sigue funcionando aunque el receptor falle al cerrarse", () => {
    const c = new CanalEnMemoria();
    c.suscribir("t1", "a", { novedades: () => {}, cerrar: () => { throw new Error("roto"); } });
    expect(() => c.expulsar("t1", "a")).not.toThrow();
    expect(c.conexiones()).toBe(0);
  });

  it("el máximo por defecto es de 64 conexiones", () => {
    expect(MAX_CONEXIONES).toBe(64);
    const c = new CanalEnMemoria();
    for (let i = 0; i < 64; i++) c.suscribir("t", `d${i}`, receptor("x", []));
    expect(c.hayLugar("t", "nuevo")).toBe(false);
    expect(c.hayLugar("t", "d0")).toBe(true);
  });

  it("dos pares viaje y dispositivo que concatenados dan lo mismo no se confunden", () => {
    const c = new CanalEnMemoria();
    const r: string[] = [];
    c.suscribir("t1", "ab", receptor("uno", r));
    c.suscribir("t1a", "b", receptor("dos", r));
    expect(c.conexiones()).toBe(2);
    expect(r).toEqual([]);
  });

  it("hayLugar respeta el máximo, pero el dispositivo que ya está conectado siempre puede reemplazar la suya", () => {
    const c = new CanalEnMemoria(2);
    c.suscribir("t1", "a", receptor("a", []));
    expect(c.hayLugar("t1", "b")).toBe(true);
    c.suscribir("t1", "b", receptor("b", []));
    expect(c.hayLugar("t1", "c")).toBe(false);
    expect(c.hayLugar("t1", "a")).toBe(true);
  });
});
