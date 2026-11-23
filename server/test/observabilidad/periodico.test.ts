import { afterEach, describe, expect, it, vi } from "vitest";
import { tareaPeriodica } from "../../src/observabilidad/periodico.js";

afterEach(() => vi.useRealTimers());

describe("tareaPeriodica", () => {
  it("programa la acción con el intervalo, no la ejecuta al empezar y devuelve cómo detenerla", () => {
    const programadas: { accion: () => void; cadaMs: number }[] = [];
    const cancelados: unknown[] = [];
    const temporizador = { id: 1 };
    let llamadas = 0;
    const detener = tareaPeriodica(() => void llamadas++, {
      cadaMs: 1234,
      programar: (accion, cadaMs) => (programadas.push({ accion, cadaMs }), temporizador),
      cancelar: (t) => cancelados.push(t),
    });
    expect(programadas).toHaveLength(1);
    expect(programadas[0]!.cadaMs).toBe(1234);
    expect(llamadas).toBe(0);
    programadas[0]!.accion();
    expect(llamadas).toBe(1);
    expect(cancelados).toEqual([]);
    detener();
    expect(cancelados).toEqual([temporizador]);
  });

  it("el temporizador no retiene al proceso (unref), y un temporizador sin unref o que no es un objeto también sirve", () => {
    let unref = 0;
    tareaPeriodica(() => {}, { cadaMs: 1, programar: () => ({ unref: () => void unref++ }), cancelar: () => {} });
    expect(unref).toBe(1);
    for (const sin of [{}, 7, null, undefined, { unref: 5 }]) expect(() => tareaPeriodica(() => {}, { cadaMs: 1, programar: () => sin, cancelar: () => {} })).not.toThrow();
  });

  it("rechaza un intervalo que no es un número positivo y no programa nada", () => {
    let programadas = 0;
    for (const cadaMs of [0, -1, NaN, Infinity, -Infinity, "5" as unknown as number, undefined as unknown as number]) {
      expect(() => tareaPeriodica(() => {}, { cadaMs, programar: () => void programadas++ })).toThrow(RangeError);
    }
    expect(programadas).toBe(0);
  });

  it("con los temporizadores reales ejecuta cada intervalo y deja de hacerlo al detenerla", () => {
    vi.useFakeTimers();
    let veces = 0;
    const detener = tareaPeriodica(() => void veces++, { cadaMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(veces).toBe(0);
    vi.advanceTimersByTime(1);
    expect(veces).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(veces).toBe(4);
    detener();
    vi.advanceTimersByTime(10_000);
    expect(veces).toBe(4);
  });
});
