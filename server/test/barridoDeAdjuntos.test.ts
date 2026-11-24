import { describe, expect, it, vi } from "vitest";
import { CADA_DIEZ_MINUTOS_MS, ESPERA_DEL_BARRIDO_MS, iniciarBarridoDeAdjuntos } from "../src/arranque.js";
import type { ResultadoDelBarrido } from "../src/dominio/adjuntos/servicioAdjuntos.js";
import { RegistroDeMemoria } from "./ayudas/registroDeMemoria.js";

const VACIO: ResultadoDelBarrido = { revisados: 0, huerfanosBorrados: 0, temporalesBorrados: 0, bytesLiberados: 0, sinRegistro: 0, desconocidos: 0, viajesDesconocidos: 0, errores: 0 };

/** Un temporizador falso que deja disparar la acción a mano. */
function reloj() {
  let accion: (() => void) | undefined;
  const cancelados: unknown[] = [];
  const t = {};
  return {
    periodo: { programar: (a: () => void) => ((accion = a), t), cancelar: (x: unknown) => cancelados.push(x) },
    disparar: () => accion!(),
    cancelados,
    t,
  };
}
const esperar = (ms = 0) => new Promise((ok) => setTimeout(ok, ms));

describe("iniciarBarridoDeAdjuntos", () => {
  it("se programa cada 10 minutos y detenerlo cancela el temporizador", async () => {
    let cadaMs = 0;
    const cancelados: unknown[] = [];
    const t = {};
    const { detener } = iniciarBarridoDeAdjuntos({
      servicio: { barrer: async () => VACIO },
      registro: new RegistroDeMemoria(),
      periodo: { programar: (_a, ms) => ((cadaMs = ms), t), cancelar: (x) => cancelados.push(x) },
    });
    expect(cadaMs).toBe(CADA_DIEZ_MINUTOS_MS);
    await detener();
    expect(cancelados).toEqual([t]);
  });

  it("cada disparo barre con la hora de ahora (la inyectada, o la del reloj si no se da una)", async () => {
    const horas: number[] = [];
    const r = reloj();
    iniciarBarridoDeAdjuntos({ servicio: { barrer: async (ahora) => (horas.push(ahora), VACIO) }, registro: new RegistroDeMemoria(), ahora: () => 12345, periodo: r.periodo });
    r.disparar();
    await esperar();
    expect(horas).toEqual([12345]);
    const r2 = reloj();
    const antes = Date.now();
    iniciarBarridoDeAdjuntos({ servicio: { barrer: async (ahora) => (horas.push(ahora), VACIO) }, registro: new RegistroDeMemoria(), periodo: r2.periodo });
    r2.disparar();
    await esperar();
    expect(horas[1]).toBeGreaterThanOrEqual(antes);
    expect(horas[1]).toBeLessThanOrEqual(Date.now());
  });

  it("registra el resultado: info si borró algo, warn si hubo errores, debug si no hizo nada", async () => {
    const registro = new RegistroDeMemoria();
    const r = reloj();
    let resultado: ResultadoDelBarrido = VACIO;
    iniciarBarridoDeAdjuntos({ servicio: { barrer: async () => resultado }, registro, periodo: r.periodo });
    const disparar = async () => {
      r.disparar();
      await esperar();
      return registro.entradas.at(-1);
    };
    expect(await disparar()).toMatchObject({ nivel: "debug", evento: "adjuntos_barrido", campos: { revisados: 0, errores: 0 } });
    resultado = { revisados: 9, huerfanosBorrados: 2, temporalesBorrados: 1, bytesLiberados: 4096, sinRegistro: 5, desconocidos: 3, viajesDesconocidos: 1, errores: 0 };
    expect(await disparar()).toEqual({
      nivel: "info",
      evento: "adjuntos_barrido",
      campos: { revisados: 9, huerfanos_borrados: 2, temporales_borrados: 1, bytes_liberados: 4096, sin_registro: 5, desconocidos: 3, viajes_desconocidos: 1, errores: 0 },
    });
    resultado = { ...VACIO, huerfanosBorrados: 1, errores: 2 };
    expect(await disparar()).toMatchObject({ nivel: "warn", evento: "adjuntos_barrido", campos: { errores: 2, huerfanos_borrados: 1 } });
    resultado = { ...VACIO, temporalesBorrados: 1 };
    expect((await disparar())?.nivel).toBe("info");
    resultado = { ...VACIO, desconocidos: 4, viajesDesconocidos: 1 };
    expect((await disparar())?.nivel).toBe("debug");
  });

  it("nunca hay dos barridos a la vez: un disparo con uno en curso se ignora, y al terminar vuelve a correr", async () => {
    const r = reloj();
    let llamadas = 0;
    let terminar!: () => void;
    iniciarBarridoDeAdjuntos({
      servicio: { barrer: () => (llamadas++, new Promise<ResultadoDelBarrido>((ok) => (terminar = () => ok(VACIO)))) },
      registro: new RegistroDeMemoria(),
      periodo: r.periodo,
    });
    r.disparar();
    r.disparar();
    r.disparar();
    await esperar();
    expect(llamadas).toBe(1);
    terminar();
    await esperar();
    r.disparar();
    await esperar();
    expect(llamadas).toBe(2);
    terminar();
  });

  it("un fallo del barrido no tumba el proceso: se registra como error con el error limpio y el siguiente corre", async () => {
    const registro = new RegistroDeMemoria();
    const r = reloj();
    let llamadas = 0;
    iniciarBarridoDeAdjuntos({
      servicio: {
        barrer: async () => {
          llamadas += 1;
          throw new Error("falló token=SECRETO-XYZ");
        },
      },
      registro,
      periodo: r.periodo,
    });
    expect(() => r.disparar()).not.toThrow();
    await esperar();
    const entrada = registro.entradas.find((x) => x.evento === "adjuntos_barrido_fallo");
    expect(entrada?.nivel).toBe("error");
    expect((entrada?.campos.err as { message: string }).message).toBe("falló token=[oculto]");
    expect(JSON.stringify(registro.entradas)).not.toContain("SECRETO-XYZ");
    r.disparar();
    await esperar();
    expect(llamadas).toBe(2);
  });

  it("detener espera al barrido que está en curso", async () => {
    const r = reloj();
    let terminar!: () => void;
    const { detener } = iniciarBarridoDeAdjuntos({
      servicio: { barrer: () => new Promise<ResultadoDelBarrido>((ok) => (terminar = () => ok(VACIO))) },
      registro: new RegistroDeMemoria(),
      periodo: r.periodo,
    });
    r.disparar();
    await esperar();
    let detenido = false;
    const parando = detener().then(() => (detenido = true));
    await esperar(30);
    expect(detenido).toBe(false);
    expect(r.cancelados).toEqual([r.t]);
    terminar();
    await parando;
    expect(detenido).toBe(true);
  });

  it("detener cancela el temporizador de su espera cuando el barrido termina antes", async () => {
    const r = reloj();
    let terminar!: () => void;
    const { detener } = iniciarBarridoDeAdjuntos({
      servicio: { barrer: () => new Promise<ResultadoDelBarrido>((ok) => (terminar = () => ok(VACIO))) },
      registro: new RegistroDeMemoria(),
      periodo: r.periodo,
      esperaMs: 60_000,
    });
    r.disparar();
    await esperar();
    const cancelados: unknown[] = [];
    const real = globalThis.clearTimeout;
    const espia = vi.spyOn(globalThis, "clearTimeout").mockImplementation(((t: Parameters<typeof clearTimeout>[0]) => {
      cancelados.push(t);
      return real(t);
    }) as typeof clearTimeout);
    try {
      const parando = detener();
      terminar();
      await parando;
    } finally {
      espia.mockRestore();
    }
    expect(cancelados).toHaveLength(1);
    expect(typeof cancelados[0]).toBe("object");
  });

  it("detener no espera para siempre: pasada la espera máxima sigue aunque el barrido no termine", async () => {
    expect(ESPERA_DEL_BARRIDO_MS).toBe(2000);
    const r = reloj();
    const { detener } = iniciarBarridoDeAdjuntos({
      servicio: { barrer: () => new Promise<ResultadoDelBarrido>(() => undefined) },
      registro: new RegistroDeMemoria(),
      periodo: r.periodo,
      esperaMs: 40,
    });
    r.disparar();
    await esperar();
    const inicio = Date.now();
    await detener();
    const tardo = Date.now() - inicio;
    expect(tardo).toBeGreaterThanOrEqual(30);
    expect(tardo).toBeLessThan(1500);
  });

  it("detener sin barrido en curso vuelve enseguida", async () => {
    const r = reloj();
    const { detener } = iniciarBarridoDeAdjuntos({ servicio: { barrer: async () => VACIO }, registro: new RegistroDeMemoria(), periodo: r.periodo, esperaMs: 5000 });
    const inicio = Date.now();
    await detener();
    expect(Date.now() - inicio).toBeLessThan(500);
  });
});
