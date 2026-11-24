import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ErrorHttp } from "../../src/http/errores.js";
import { LimiteDeSubidas } from "../../src/http/limiteDeSubidas.js";
import { crearEsperarTurno } from "../../src/http/rutasAdjuntos.js";
import { MetricasEnMemoria } from "../../src/observabilidad/metricas.js";
import { RegistroDeMemoria } from "../ayudas/registroDeMemoria.js";

/** Un pedido y una respuesta falsos: se controla a mano si la conexión está cerrada y cuándo se emite `close`. */
function conexion() {
  const raw = Object.assign(new EventEmitter(), { destroyed: false, socket: { destroyed: false } });
  const cabeceras: Record<string, string> = {};
  const reply = { raw: new EventEmitter(), header: (k: string, v: string) => ((cabeceras[k] = v), reply) };
  const registro = new RegistroDeMemoria();
  const request = { raw, registro };
  return { raw, reply, request, registro, cabeceras, cerrar: () => reply.raw.emit("close") };
}
const libre = () => new AbortController().signal;
const codigoDe = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorHttp);
    return `${(e as ErrorHttp).estado} ${(e as ErrorHttp).codigo}`;
  }
  return "sin error";
};

function armar(maximo = 1, espera = 1) {
  const limite = new LimiteDeSubidas(maximo, espera);
  const metricas = new MetricasEnMemoria();
  return { limite, metricas, esperarTurno: crearEsperarTurno(limite, metricas) };
}
const contar = (m: MetricasEnMemoria) => m.resumen().contadores.find((c) => c.nombre === "adjuntos_sin_lugar")?.valor;

describe("crearEsperarTurno", () => {
  it("toma un lugar y lo devuelve cuando la respuesta se cierra", async () => {
    const { limite, esperarTurno } = armar(1, 0);
    const c = conexion();
    await esperarTurno(c.request as never, c.reply as never);
    expect(limite.ocupados).toBe(1);
    c.cerrar();
    expect(limite.ocupados).toBe(0);
  });

  it("si la conexión ya estaba cerrada (el pedido o el socket) no pide lugar y falla con subida_cancelada", async () => {
    for (const cerrarAntes of [(c: ReturnType<typeof conexion>) => (c.raw.destroyed = true), (c: ReturnType<typeof conexion>) => (c.raw.socket.destroyed = true)]) {
      const { limite, metricas, esperarTurno } = armar(1, 1);
      const c = conexion();
      cerrarAntes(c);
      expect(await codigoDe(esperarTurno(c.request as never, c.reply as never))).toBe("400 subida_cancelada");
      expect([limite.ocupados, limite.enEspera, contar(metricas)]).toEqual([0, 0, undefined]);
    }
  });

  it("si la conexión se cierra mientras espera, sale de la cola con subida_cancelada y no cuenta como sin lugar", async () => {
    const { limite, metricas, esperarTurno } = armar(1, 1);
    await limite.pedir(1000, libre());
    const c = conexion();
    const turno = codigoDe(esperarTurno(c.request as never, c.reply as never));
    expect(limite.enEspera).toBe(1);
    c.cerrar();
    expect(await turno).toBe("400 subida_cancelada");
    expect([limite.ocupados, limite.enEspera, contar(metricas)]).toEqual([1, 0, undefined]);
    expect(c.registro.entradas.some((x) => x.evento === "subida_sin_lugar")).toBe(false);
  });

  it("si la conexión se cerró justo cuando le daban el turno, devuelve el lugar enseguida (su close ya pasó)", async () => {
    const { limite, esperarTurno } = armar(1, 1);
    const liberarPrimero = await limite.pedir(1000, libre());
    const c = conexion();
    const turno = esperarTurno(c.request as never, c.reply as never);
    // el socket se destruye sin que llegue a emitirse close en esta respuesta, y en ese momento se libera el lugar
    c.raw.socket.destroyed = true;
    liberarPrimero();
    await turno;
    expect(limite.ocupados).toBe(0);
  });

  it("sin lugar: 503 servidor_ocupado con Retry-After de 10 s, métrica y aviso en el registro", async () => {
    const { limite, metricas, esperarTurno } = armar(1, 0);
    await limite.pedir(1000, libre());
    const c = conexion();
    expect(await codigoDe(esperarTurno(c.request as never, c.reply as never))).toBe("503 servidor_ocupado");
    expect(c.cabeceras["retry-after"]).toBe("10");
    expect(contar(metricas)).toBe(1);
    expect(c.registro.entradas.find((x) => x.evento === "subida_sin_lugar")).toMatchObject({ nivel: "warn", campos: { motivo: "hay demasiadas subidas esperando" } });
  });
});
