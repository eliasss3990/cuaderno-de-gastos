import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPERA_MAXIMA_DE_SUBIDA_MS, LimiteDeSubidas, MAX_SUBIDAS_EN_ESPERA, MAX_SUBIDAS_SIMULTANEAS, SinLugarParaSubir, SubidaCancelada } from "../../src/http/limiteDeSubidas.js";

afterEach(() => {
  vi.useRealTimers();
});
const senal = () => new AbortController().signal;

describe("LimiteDeSubidas", () => {
  it("los valores por defecto: 2 a la vez, 8 esperando y 30 segundos de espera", async () => {
    expect([MAX_SUBIDAS_SIMULTANEAS, MAX_SUBIDAS_EN_ESPERA, ESPERA_MAXIMA_DE_SUBIDA_MS]).toEqual([2, 8, 30_000]);
    const l = new LimiteDeSubidas();
    await l.pedir(1000, senal());
    await l.pedir(1000, senal());
    expect(l.ocupados).toBe(2);
    const tercero = l.pedir(1000, senal());
    expect(l.enEspera).toBe(1);
    for (let i = 0; i < 7; i++) void l.pedir(1000, senal()).catch(() => undefined);
    await expect(l.pedir(1000, senal())).rejects.toThrow(SinLugarParaSubir);
    void tercero.catch(() => undefined);
  });

  it("da lugar enseguida hasta el máximo y lo devuelve al liberar", async () => {
    const l = new LimiteDeSubidas(2, 0);
    const a = await l.pedir(1000, senal());
    await l.pedir(1000, senal());
    expect(l.ocupados).toBe(2);
    a();
    expect(l.ocupados).toBe(1);
    await l.pedir(1000, senal());
    expect(l.ocupados).toBe(2);
  });

  it("liberar dos veces libera un solo lugar", async () => {
    const l = new LimiteDeSubidas(2, 0);
    const a = await l.pedir(1000, senal());
    await l.pedir(1000, senal());
    a();
    a();
    expect(l.ocupados).toBe(1);
  });

  it("los que esperan reciben el turno en orden de llegada al liberarse un lugar", async () => {
    const l = new LimiteDeSubidas(1, 5);
    const primero = await l.pedir(1000, senal());
    const orden: string[] = [];
    const b = l.pedir(1000, senal()).then((liberar) => (orden.push("b"), liberar));
    const c = l.pedir(1000, senal()).then((liberar) => (orden.push("c"), liberar));
    expect([l.ocupados, l.enEspera]).toEqual([1, 2]);
    primero();
    const liberarB = await b;
    expect([orden, l.ocupados, l.enEspera]).toEqual([["b"], 1, 1]);
    liberarB();
    (await c)();
    expect([orden, l.ocupados, l.enEspera]).toEqual([["b", "c"], 0, 0]);
  });

  it("con la cola llena falla enseguida con SinLugarParaSubir; sin cola, también", async () => {
    const l = new LimiteDeSubidas(1, 1);
    await l.pedir(1000, senal());
    void l.pedir(1000, senal()).catch(() => undefined);
    await expect(l.pedir(1000, senal())).rejects.toThrow("hay demasiadas subidas esperando");
    const sinCola = new LimiteDeSubidas(1, 0);
    await sinCola.pedir(1000, senal());
    await expect(sinCola.pedir(1000, senal())).rejects.toBeInstanceOf(SinLugarParaSubir);
    expect(sinCola.enEspera).toBe(0);
  });

  it("si vence el plazo sale de la cola con SinLugarParaSubir y no se lleva un lugar después", async () => {
    vi.useFakeTimers();
    const l = new LimiteDeSubidas(1, 3);
    const liberar = await l.pedir(1000, senal());
    const esperando = l.pedir(500, senal());
    const resultado = esperando.catch((e: unknown) => e);
    vi.advanceTimersByTime(499);
    expect(l.enEspera).toBe(1);
    vi.advanceTimersByTime(1);
    expect(await resultado).toBeInstanceOf(SinLugarParaSubir);
    expect(((await resultado) as Error).message).toBe("se terminó el plazo de espera");
    expect(l.enEspera).toBe(0);
    liberar();
    expect(l.ocupados).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("una señal ya abortada falla enseguida con SubidaCancelada sin ocupar nada", async () => {
    const l = new LimiteDeSubidas(2, 2);
    const control = new AbortController();
    control.abort();
    await expect(l.pedir(1000, control.signal)).rejects.toBeInstanceOf(SubidaCancelada);
    expect([l.ocupados, l.enEspera]).toEqual([0, 0]);
  });

  it("si se aborta mientras espera, sale de la cola con SubidaCancelada y su turno pasa al siguiente", async () => {
    vi.useFakeTimers();
    const l = new LimiteDeSubidas(1, 3);
    const liberar = await l.pedir(1000, senal());
    const control = new AbortController();
    const cancelado = l.pedir(10_000, control.signal).catch((e: unknown) => e);
    const siguiente = l.pedir(10_000, senal());
    control.abort();
    expect(await cancelado).toBeInstanceOf(SubidaCancelada);
    expect(l.enEspera).toBe(1);
    liberar();
    await siguiente;
    expect([l.ocupados, l.enEspera]).toEqual([1, 0]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("al recibir el turno se cancela su plazo y deja de escuchar la señal", async () => {
    vi.useFakeTimers();
    const l = new LimiteDeSubidas(1, 1);
    const liberar = await l.pedir(1000, senal());
    const control = new AbortController();
    const quitar = vi.spyOn(control.signal, "removeEventListener");
    const turno = l.pedir(5000, control.signal);
    liberar();
    const liberarTurno = await turno;
    expect(vi.getTimerCount()).toBe(0);
    expect(quitar).toHaveBeenCalledWith("abort", expect.any(Function));
    control.abort();
    await Promise.resolve();
    expect(l.ocupados).toBe(1);
    liberarTurno();
    expect(l.ocupados).toBe(0);
  });
});
