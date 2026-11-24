import { afterEach, describe, expect, it, vi } from "vitest";
import { EscritorSse, eventoDeNovedades, LATIDOS_SIN_VACIAR, PLAZO_DE_CIERRE_MS, type SalidaSse } from "../../src/http/escritorSse.js";

function salidaFalsa() {
  const s = { escrito: [] as string[], terminada: 0, destruida: 0, writableNeedDrain: false as boolean };
  const salida: SalidaSse = {
    write: (t) => s.escrito.push(t),
    end: () => { s.terminada += 1; },
    destroy: () => { s.destruida += 1; },
    get writableNeedDrain() { return s.writableNeedDrain; },
  };
  return { s, salida };
}

afterEach(() => { vi.useRealTimers(); });

describe("EscritorSse", () => {
  it("tras terminar la respuesta, destruye el socket si el cliente no la cierra en el plazo", () => {
    vi.useFakeTimers();
    const { s, salida } = salidaFalsa();
    new EscritorSse(salida).cerrar();
    vi.advanceTimersByTime(PLAZO_DE_CIERRE_MS - 1);
    expect(s.destruida).toBe(0);
    vi.advanceTimersByTime(1);
    expect(s.destruida).toBe(1);
  });

  it("el plazo de cierre es de 2 segundos y su temporizador no mantiene vivo el proceso", () => {
    expect(PLAZO_DE_CIERRE_MS).toBe(2000);
    vi.useFakeTimers();
    const creados: { hasRef(): boolean }[] = [];
    const real = globalThis.setTimeout;
    const espia = vi.spyOn(globalThis, "setTimeout").mockImplementation(((...a: Parameters<typeof setTimeout>) => {
      const t = real(...a);
      creados.push(t as unknown as { hasRef(): boolean });
      return t;
    }) as typeof setTimeout);
    try {
      new EscritorSse(salidaFalsa().salida).cerrar();
      expect(creados).toHaveLength(1);
      expect(creados[0]?.hasRef()).toBe(false);
    } finally {
      espia.mockRestore();
    }
  });

  it("si el socket se cierra por su cuenta antes del plazo, no se destruye", () => {
    vi.useFakeTimers();
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    w.cerrar();
    w.marcarCerrado();
    vi.advanceTimersByTime(PLAZO_DE_CIERRE_MS * 2);
    expect(s.destruida).toBe(0);
  });

  it("marcarCerrado sin haber cerrado la respuesta no programa nada", () => {
    vi.useFakeTimers();
    const { s, salida } = salidaFalsa();
    new EscritorSse(salida).marcarCerrado();
    vi.advanceTimersByTime(PLAZO_DE_CIERRE_MS * 2);
    expect([s.destruida, s.terminada]).toEqual([0, 0]);
  });

  it("el evento lleva id, nombre y la cabeza como JSON", () => {
    expect(eventoDeNovedades(12)).toBe('id: 12\nevent: novedades\ndata: {"head_seq":12}\n\n');
  });

  it("al abrir manda el retry y la cabeza de ahora", () => {
    const { s, salida } = salidaFalsa();
    new EscritorSse(salida).abrir(5);
    expect(s.escrito).toEqual([`retry: 5000\n\n${eventoDeNovedades(5)}`]);
  });

  it("escribe las novedades y el latido como comentario", () => {
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    w.novedades(3);
    w.latido();
    expect(s.escrito).toEqual([eventoDeNovedades(3), ":\n\n"]);
  });

  it("con el socket lleno guarda solo el último aviso y lo manda al vaciarse", () => {
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    s.writableNeedDrain = true;
    w.novedades(1);
    w.novedades(2);
    w.novedades(3);
    expect(s.escrito).toEqual([]);
    s.writableNeedDrain = false;
    w.vaciada();
    expect(s.escrito).toEqual([eventoDeNovedades(3)]);
    w.vaciada();
    expect(s.escrito).toHaveLength(1);
  });

  it("vaciada con el socket todavía lleno vuelve a dejar el aviso esperando", () => {
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    s.writableNeedDrain = true;
    w.novedades(9);
    w.vaciada();
    expect(s.escrito).toEqual([]);
    s.writableNeedDrain = false;
    w.vaciada();
    expect(s.escrito).toEqual([eventoDeNovedades(9)]);
  });

  it("con el socket lleno no escribe latidos y tras varios seguidos corta al cliente", () => {
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    s.writableNeedDrain = true;
    for (let i = 1; i < LATIDOS_SIN_VACIAR; i++) w.latido();
    expect(s.destruida).toBe(0);
    w.latido();
    expect(s.destruida).toBe(1);
    expect(s.escrito).toEqual([]);
  });

  it("vaciar el socket reinicia la cuenta de latidos sin vaciar", () => {
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    s.writableNeedDrain = true;
    for (let i = 1; i < LATIDOS_SIN_VACIAR; i++) w.latido();
    w.vaciada();
    for (let i = 1; i < LATIDOS_SIN_VACIAR; i++) w.latido();
    expect(s.destruida).toBe(0);
  });

  it("cerrar termina la respuesta una sola vez y después no se escribe nada", () => {
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    w.cerrar();
    w.cerrar();
    w.novedades(1);
    w.latido();
    w.abrir(1);
    expect([s.terminada, s.escrito]).toEqual([1, []]);
  });

  it("si el socket ya se cerró no se escribe ni se vuelve a terminar ni a destruir", () => {
    const { s, salida } = salidaFalsa();
    const w = new EscritorSse(salida);
    w.marcarCerrado();
    w.novedades(1);
    w.cerrar();
    s.writableNeedDrain = true;
    for (let i = 0; i < LATIDOS_SIN_VACIAR + 2; i++) w.latido();
    expect([s.terminada, s.destruida, s.escrito]).toEqual([0, 0, []]);
  });
});
