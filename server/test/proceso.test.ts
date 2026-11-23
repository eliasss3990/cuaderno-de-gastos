import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { instalarApagado, instalarErroresFatales } from "../src/proceso.js";
import { RegistroDeMemoria } from "./ayudas/registroDeMemoria.js";

/** Un proceso de mentira: se le emiten señales y errores, y `salir` solo anota el código. */
function entorno() {
  const emisor = new EventEmitter();
  const registro = new RegistroDeMemoria();
  const salidas: number[] = [];
  const salir = (codigo: number): void => void salidas.push(codigo);
  return { emisor, registro, salidas, salir };
}
const esperar = (ms = 20) => new Promise((resolver) => setTimeout(resolver, ms));

describe("instalarErroresFatales", () => {
  it("una excepción no capturada y una promesa rechazada se registran como error, con lo reconocible oculto, y se sale con 1", () => {
    const e = entorno();
    instalarErroresFatales(e.registro, e.salir, e.emisor);
    e.emisor.emit("uncaughtException", new Error("falló con token=SECRETO-XYZ"));
    e.emisor.emit("unhandledRejection", new Error("rechazada con Bearer ABCDEF"));
    expect(e.registro.entradas.map((x) => [x.nivel, x.evento])).toEqual([["error", "excepcion_no_capturada"], ["error", "promesa_rechazada"]]);
    expect((e.registro.entradas[0]!.campos.err as { message: string }).message).toBe("falló con token=[oculto]");
    expect((e.registro.entradas[1]!.campos.err as { message: string }).message).toBe("rechazada con Bearer [oculto]");
    expect(e.salidas).toEqual([1, 1]);
    expect(JSON.stringify(e.registro.entradas)).not.toContain("SECRETO-XYZ");
  });

  it("también acepta lo que no es un Error (un texto, undefined) y devuelve la función para reutilizarla", () => {
    const e = entorno();
    const morir = instalarErroresFatales(e.registro, e.salir, e.emisor);
    e.emisor.emit("unhandledRejection", "solo un texto");
    e.emisor.emit("unhandledRejection", undefined);
    morir("arranque_fallo", new Error("no arrancó"));
    expect(e.registro.entradas.map((x) => x.evento)).toEqual(["promesa_rechazada", "promesa_rechazada", "arranque_fallo"]);
    expect(e.salidas).toEqual([1, 1, 1]);
  });

  it("si el propio registro falla igual se sale con 1 (y el fallo no se traga)", () => {
    const e = entorno();
    const roto = { debug() {}, info() {}, warn() {}, hijo() { return roto; }, error() { throw new Error("el registro falló"); } };
    const morir = instalarErroresFatales(roto, e.salir, e.emisor);
    expect(() => morir("x", new Error("y"))).toThrow("el registro falló");
    expect(e.salidas).toEqual([1]);
  });

  it("no instala nada más que esos dos manejadores", () => {
    const e = entorno();
    instalarErroresFatales(e.registro, e.salir, e.emisor);
    expect(e.emisor.eventNames().sort()).toEqual(["uncaughtException", "unhandledRejection"]);
  });
});

describe("instalarApagado", () => {
  const servidorQue = (detener: () => Promise<void>) => Promise.resolve({ detener });

  it("con SIGTERM o SIGINT detiene el servidor, lo registra y sale con 0 (solo después de detener)", async () => {
    for (const senal of ["SIGTERM", "SIGINT"]) {
      const e = entorno();
      let detenido = false;
      let salioAntes = false;
      instalarApagado(e.registro, servidorQue(async () => { await esperar(30); detenido = true; }), () => {}, (c) => { salioAntes = !detenido; e.salir(c); }, e.emisor);
      e.emisor.emit(senal);
      expect(e.registro.entradas.map((x) => [x.nivel, x.evento, x.campos.senal])).toEqual([["info", "apagando", senal]]);
      expect(e.salidas).toEqual([]);
      await esperar(80);
      expect(detenido).toBe(true);
      expect(salioAntes).toBe(false);
      expect(e.salidas).toEqual([0]);
    }
  });

  it("una señal repetida mientras se apaga se registra y se ignora: se detiene una sola vez", async () => {
    const e = entorno();
    let veces = 0;
    instalarApagado(e.registro, servidorQue(async () => { veces++; await esperar(30); }), () => {}, e.salir, e.emisor);
    e.emisor.emit("SIGTERM");
    e.emisor.emit("SIGINT");
    e.emisor.emit("SIGTERM");
    await esperar(80);
    expect(veces).toBe(1);
    expect(e.salidas).toEqual([0]);
    expect(e.registro.entradas.map((x) => [x.nivel, x.evento, x.campos.senal])).toEqual([["info", "apagando", "SIGTERM"], ["warn", "senal_repetida", "SIGINT"], ["warn", "senal_repetida", "SIGTERM"]]);
  });

  it("una señal que llega antes de que termine el arranque espera a que termine y recién ahí detiene", async () => {
    const e = entorno();
    let listo!: (s: { detener(): Promise<void> }) => void;
    const arranque = new Promise<{ detener(): Promise<void> }>((resolver) => (listo = resolver));
    let detenciones = 0;
    instalarApagado(e.registro, arranque, () => {}, e.salir, e.emisor);
    e.emisor.emit("SIGTERM");
    await esperar(30);
    expect(detenciones).toBe(0);
    expect(e.salidas).toEqual([]);
    listo({ detener: async () => void detenciones++ });
    await esperar(30);
    expect(detenciones).toBe(1);
    expect(e.salidas).toEqual([0]);
  });

  it("si detener falla se registra apagado_fallo por el manejador fatal y no se sale con 0", async () => {
    const e = entorno();
    const morir = instalarErroresFatales(e.registro, e.salir, new EventEmitter());
    instalarApagado(e.registro, servidorQue(async () => { throw new Error("no se pudo cerrar la base"); }), morir, e.salir, e.emisor);
    e.emisor.emit("SIGTERM");
    await esperar(30);
    expect(e.registro.entradas.map((x) => x.evento)).toEqual(["apagando", "apagado_fallo"]);
    expect(e.salidas).toEqual([1]);
  });

  it("si el arranque falló no hay nada que detener: no sale con 0 ni registra otro error", async () => {
    const e = entorno();
    const fallado = Promise.reject(new Error("no arrancó"));
    fallado.catch(() => {});
    const muertes: string[] = [];
    instalarApagado(e.registro, fallado, (evento) => void muertes.push(evento), e.salir, e.emisor);
    e.emisor.emit("SIGTERM");
    await esperar(30);
    expect(e.salidas).toEqual([]);
    expect(muertes).toEqual([]); // no vuelve a matar: el fallo del arranque ya lo registró y sale quien lo registró
    expect(e.registro.entradas.map((x) => x.evento)).toEqual(["apagando"]);
  });

  it("solo atiende SIGTERM y SIGINT", () => {
    const e = entorno();
    instalarApagado(e.registro, servidorQue(async () => {}), () => {}, e.salir, e.emisor);
    expect(e.emisor.eventNames().sort()).toEqual(["SIGINT", "SIGTERM"]);
  });
});
