import { afterEach, describe, expect, it, vi } from "vitest";
import { LATIDO_MS } from "../../src/http/rutasSincronizacion.js";
import { CanalEnMemoria } from "../../src/dominio/operaciones/canalEnVivo.js";
import { AHORA, entornoApi, NUEVO, type Alta } from "../ayudas/entornoApi.js";

const marca = (a: Alta, n: number): string => `${(AHORA - 5000 + n).toString(16).padStart(13, "0")}-${n.toString(16).padStart(4, "0")}-${a.device_id}`;
const categoria = (a: Alta, n: number) => ({
  op_id: `018f3a6e-9000-7000-8000-${String(n).padStart(12, "0")}`,
  type: "category.create",
  entity_type: "category",
  entity_id: `018f3a6e-7000-7000-8000-${String(n).padStart(12, "0")}`,
  hlc: marca(a, n),
  payload: { nombre: `Cat ${n}`, color: "#E8E4F3", emoji: "🛣️" },
  schema_version: 1,
});

const abiertos: AbortController[] = [];
afterEach(() => { for (const c of abiertos.splice(0)) c.abort(); });

/** Un cliente SSE real contra el servidor en un puerto efímero. */
async function conectar(base: string, trip: string, token: string) {
  const ctl = new AbortController();
  abiertos.push(ctl);
  const r = await fetch(`${base}/v1/trips/${trip}/events`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
  const lector = r.body?.getReader();
  const decodificador = new TextDecoder();
  let texto = "";
  let terminado = false;
  let lectura: Promise<void> | null = null;
  /** Una sola lectura pendiente a la vez: lo que llega siempre se acumula, aunque nadie la esté esperando. */
  const bombear = (ms: number): Promise<unknown> => {
    lectura ??= lector!.read().then((x) => {
      lectura = null;
      if (x.value !== undefined) texto += decodificador.decode(x.value);
      if (x.done) terminado = true;
    });
    return Promise.race([lectura, new Promise((ok) => setTimeout(ok, ms))]);
  };
  async function hasta(fragmento: string, ms = 2000): Promise<string> {
    const fin = Date.now() + ms;
    while (!texto.includes(fragmento)) {
      if (Date.now() > fin || terminado) throw new Error(`no llegó "${fragmento}"; llegó ${JSON.stringify(texto)}`);
      await bombear(50);
    }
    return texto;
  }
  /** Sigue leyendo durante `ms` y devuelve lo que llegó en ese tiempo (para comprobar que NO llega nada). */
  async function escuchar(ms: number): Promise<string> {
    const antes = texto.length;
    const fin = Date.now() + ms;
    while (Date.now() < fin && !terminado) await bombear(25);
    return texto.slice(antes);
  }
  /** Espera a que el servidor termine la respuesta; false si sigue abierta pasado el plazo. */
  async function alFinal(ms = 1500): Promise<boolean> {
    const fin = Date.now() + ms;
    while (Date.now() < fin && !terminado) await bombear(50);
    return terminado;
  }
  return { respuesta: r, hasta, escuchar, alFinal, texto: () => texto, cerrar: () => ctl.abort() };
}

async function servidor(opciones: Parameters<typeof entornoApi>[0] = {}) {
  const e = entornoApi(opciones);
  await e.app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(e.app.server.address() as { port: number }).port}`;
  const a = await e.crearViaje();
  return { e, base, a };
}

describe("GET /v1/trips/:trip/events", () => {
  it("abre con las cabeceras del canal, el retry y la cabeza de ahora", async () => {
    const { e, base, a } = await servidor();
    const c = await conectar(base, a.trip_id, a.token);
    expect(c.respuesta.status).toBe(200);
    expect(c.respuesta.headers.get("content-type")).toBe("text/event-stream");
    expect(c.respuesta.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(c.respuesta.headers.get("x-accel-buffering")).toBe("no");
    const t = await c.hasta("head_seq");
    expect(t).toMatch(/^retry: 5000\n\nid: \d+\nevent: novedades\ndata: \{"head_seq":\d+\}\n\n/);
    c.cerrar();
    await e.app.close();
  });

  it("cuando otro dispositivo sube operaciones, el conectado recibe el aviso con la nueva cabeza; los de otro viaje no", async () => {
    const { e, base, a } = await servidor();
    const b = await e.sumar(a);
    const ajeno = await e.crearViaje();
    const cb = await conectar(base, a.trip_id, b.token);
    const cajeno = await conectar(base, ajeno.trip_id, ajeno.token);
    await cb.hasta("head_seq");
    await cajeno.hasta("head_seq");
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/ops`, headers: e.con(a.token), payload: { ops: [categoria(a, 1)] } });
    const cabeza = (await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head`, headers: e.con(a.token) })).json<{ head_seq: number }>().head_seq;
    expect(r.statusCode).toBe(200);
    await cb.hasta(`id: ${cabeza}\n`);
    expect(await cajeno.escuchar(150)).toBe("");
    await e.app.close();
  });

  it("cuando se une un integrante nuevo, los conectados reciben el aviso con la nueva cabeza", async () => {
    const { e, base, a } = await servidor();
    const c = await conectar(base, a.trip_id, a.token);
    await c.hasta("head_seq");
    await e.sumar(a);
    const cabeza = (await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head`, headers: e.con(a.token) })).json<{ head_seq: number }>().head_seq;
    await c.hasta(`id: ${cabeza}\n`);
    await e.app.close();
  });

  it("un viaje nunca tiene más de 4 conexiones: una por dispositivo activo y reconectar reemplaza", async () => {
    const { e, base, a } = await servidor();
    const altas = [a, await e.sumar(a), await e.sumar(a, { ...NUEVO, apodo: "Ana2" }), await e.sumar(a, { ...NUEVO, apodo: "Ana3" })];
    const conexiones = [];
    for (const alta of altas) {
      for (let vez = 0; vez < 2; vez++) {
        const c = await conectar(base, a.trip_id, alta.token);
        await c.hasta("head_seq");
        conexiones.push(c);
      }
    }
    expect(e.canal.conexiones()).toBe(4);
    const { cuerpo } = await e.invitar(a.token, a.trip_id);
    expect((await e.unirse(cuerpo.codigo, { ...NUEVO, apodo: "Quinto" })).statusCode).toBe(409); // viaje_completo
    for (const c of conexiones) c.cerrar();
    await e.app.close();
  });

  it("un dispositivo revocado por otro camino (la administración, en otro proceso) pierde el canal en el siguiente latido", async () => {
    const { e, base, a } = await servidor({ latidoMs: 50 });
    const b = await e.sumar(a);
    const ca = await conectar(base, a.trip_id, a.token);
    const cb = await conectar(base, a.trip_id, b.token);
    await ca.hasta("head_seq");
    await cb.hasta("head_seq");
    // como lo hace la administración: marca la revocación en la base sin pasar por el canal
    e.identidad.revocar(b.device_id, AHORA);
    expect(await cb.alFinal(2000)).toBe(true);
    expect(e.canal.conexiones()).toBe(1);
    // el que sigue activo conserva el canal y sus latidos
    expect(await ca.escuchar(200)).toContain(":");
    expect(e.canal.conexiones()).toBe(1);
    // con el lugar libre entra un integrante nuevo: nunca más de 4
    const c = await e.sumar(a, { ...NUEVO, apodo: "Nueva" });
    const cc = await conectar(base, a.trip_id, c.token);
    await cc.hasta("head_seq");
    expect(e.canal.conexiones()).toBe(2);
    ca.cerrar();
    cc.cerrar();
    await e.app.close();
  });

  it("reemplazar a un integrante con una invitación cierra el canal del dispositivo reemplazado y no el de los demás", async () => {
    const { e, base, a } = await servidor();
    const b = await e.sumar(a);
    const cb = await conectar(base, a.trip_id, b.token);
    const ca = await conectar(base, a.trip_id, a.token);
    await cb.hasta("head_seq");
    await ca.hasta("head_seq");
    const { cuerpo } = await e.invitar(a.token, a.trip_id, { reemplaza_member_id: b.member_id });
    const r = await e.unirse(cuerpo.codigo, { nombre_dispositivo: "Celular nuevo de Ana", apodo: "Ana", color: "#FFE4E1", emoji: "👩" });
    expect(r.statusCode).toBe(201);
    expect(await cb.alFinal()).toBe(true);
    expect(e.canal.conexiones()).toBe(1);
    await e.app.close();
  });

  it("si el aviso al canal falla después del alta, el alta igual responde 201 y queda en el registro", async () => {
    class CanalRoto extends CanalEnMemoria {
      override notificar(): void {
        throw new Error("el canal falló");
      }
    }
    const { e, a } = await servidor({ canal: new CanalRoto() });
    const { cuerpo } = await e.invitar(a.token, a.trip_id);
    const r = await e.unirse(cuerpo.codigo);
    expect(r.statusCode).toBe(201);
    expect(e.registro.entradas.some((x) => x.evento === "aviso_de_alta_fallo" && x.nivel === "warn")).toBe(true);
    await e.app.close();
  });

  it("un lote sin operaciones aceptadas no avisa", async () => {
    const { e, base, a } = await servidor();
    const c = await conectar(base, a.trip_id, a.token);
    await c.hasta("head_seq");
    await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/ops`, headers: e.con(a.token), payload: { ops: [{ ...categoria(a, 1), type: "no.existe" }] } });
    expect(await c.escuchar(150)).toBe("");
    await e.app.close();
  });

  it("un reintento que solo trae duplicados no avisa", async () => {
    const { e, base, a } = await servidor();
    const c = await conectar(base, a.trip_id, a.token);
    await c.hasta("head_seq");
    const subir = () => e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/ops`, headers: e.con(a.token), payload: { ops: [categoria(a, 1)] } });
    await subir();
    expect(await c.escuchar(150)).toContain("event: novedades");
    await subir();
    expect(await c.escuchar(150)).toBe("");
    await e.app.close();
  });

  it("al abrir informa exactamente la cabeza de ese momento", async () => {
    const { e, base, a } = await servidor();
    const cabeza = (await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head`, headers: e.con(a.token) })).json<{ head_seq: number }>().head_seq;
    expect(cabeza).toBeGreaterThan(0);
    const c = await conectar(base, a.trip_id, a.token);
    await c.hasta("head_seq");
    expect(c.texto()).toBe(`retry: 5000\n\nid: ${cabeza}\nevent: novedades\ndata: {"head_seq":${cabeza}}\n\n`);
    await e.app.close();
  });

  it("si la cabeza no se puede leer antes de tomar el socket, es un 500 normal y no queda nada suscripto", async () => {
    const { e, a } = await servidor();
    const espia = vi.spyOn(e.sincronizacion, "cabeza").mockImplementation(() => { throw new Error("disco lleno"); });
    const r = await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/events`, headers: e.con(a.token) });
    espia.mockRestore();
    expect(r.statusCode).toBe(500);
    expect(r.json<{ error: { codigo: string } }>().error.codigo).toBe("error_interno");
    expect(e.canal.conexiones()).toBe(0);
    await e.app.close();
  });

  it("si falla algo después de tomar el socket, se corta la conexión (no queda colgada) y no queda nada suscripto ni el latido vivo", async () => {
    class CanalRoto extends CanalEnMemoria {
      override suscribir(): () => void { throw new Error("falla al suscribir"); }
    }
    const { e, base, a } = await servidor({ canal: new CanalRoto() });
    // el servidor corta el socket antes de enviar nada: el cliente ve un error de conexión, no una respuesta colgada
    const ctl = new AbortController();
    abiertos.push(ctl);
    await expect(fetch(`${base}/v1/trips/${a.trip_id}/events`, { headers: { authorization: `Bearer ${a.token}` }, signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(1500)]) })).rejects.toThrow(/fetch failed/);
    expect(e.canal.conexiones()).toBe(0);
    expect(e.registro.entradas.some((x) => x.evento === "canal_fallo" && x.nivel === "error")).toBe(true);
    expect(e.registro.entradas.some((x) => x.evento === "canal_cerrado")).toBe(true);
    await e.app.close();
  });

  it("revocar un dispositivo cierra su canal abierto y no toca los de los demás", async () => {
    const { e, base, a } = await servidor();
    const b = await e.sumar(a);
    const cb = await conectar(base, a.trip_id, b.token);
    const ca = await conectar(base, a.trip_id, a.token);
    await cb.hasta("head_seq");
    await ca.hasta("head_seq");
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/devices/${b.device_id}/revoke`, headers: e.con(a.token) });
    expect(r.statusCode).toBe(204);
    expect(await cb.alFinal(1500)).toBe(true);
    expect(await ca.escuchar(150)).toBe("");
    expect(e.canal.conexiones()).toBe(1);
    await e.app.close();
  });

  it("si la revocación falla (quien la pide no es organizador), no se cierra el canal del otro", async () => {
    const { e, base, a } = await servidor();
    const b = await e.sumar(a);
    const c = await e.sumar(a, { nombre_dispositivo: "Celular de Luis", apodo: "Luis", color: "#E0FFE0", emoji: "🧑" });
    const canalC = await conectar(base, a.trip_id, c.token);
    await canalC.hasta("head_seq");
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/devices/${c.device_id}/revoke`, headers: e.con(b.token) });
    expect(r.statusCode).toBe(403);
    expect(await canalC.escuchar(150)).toBe("");
    expect(e.canal.conexiones()).toBe(1);
    await e.app.close();
  });

  it("si el cliente ya se fue cuando corre el handler, no queda suscripto ni se registra una apertura", async () => {
    const { e, a } = await servidor();
    const abortada = AbortSignal.abort();
    await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/events`, headers: e.con(a.token), signal: abortada }).catch(() => undefined);
    await new Promise((ok) => setTimeout(ok, 50));
    expect(e.canal.conexiones()).toBe(0);
    expect(e.registro.entradas.some((x) => x.evento === "canal_abierto")).toBe(false);
    await e.app.close();
  });

  it("el latido por defecto es de 20 segundos", () => {
    expect(LATIDO_MS).toBe(20_000);
  });

  it("manda un latido como comentario cuando no hay novedades", async () => {
    const { e, base, a } = await servidor({ latidoMs: 40 });
    const c = await conectar(base, a.trip_id, a.token);
    await c.hasta("\n:\n\n");
    await e.app.close();
  });

  it("una segunda conexión del mismo dispositivo cierra la primera", async () => {
    const { e, base, a } = await servidor();
    const uno = await conectar(base, a.trip_id, a.token);
    await uno.hasta("head_seq");
    const dos = await conectar(base, a.trip_id, a.token);
    await dos.hasta("head_seq");
    expect(await uno.alFinal()).toBe(true);
    expect(e.canal.conexiones()).toBe(1);
    await e.app.close();
  });

  it("sin token es 401, con el token de otro viaje es 404 y sin lugar es 503 canal_lleno", async () => {
    const { e, a } = await servidor({ canal: new CanalEnMemoria(1) });
    expect((await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/events` })).statusCode).toBe(401);
    const ajeno = await e.crearViaje();
    expect((await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/events`, headers: e.con(ajeno.token) })).statusCode).toBe(404);
    e.canal.suscribir("otro", "otro", { novedades: () => {}, cerrar: () => {} });
    const r = await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/events`, headers: e.con(a.token) });
    expect(r.statusCode).toBe(503);
    expect(r.json<{ error: { codigo: string } }>().error.codigo).toBe("canal_lleno");
    await e.app.close();
  });

  it("al cerrar la conexión se da de baja, y queda en el registro y en las métricas", async () => {
    const { e, base, a } = await servidor();
    const c = await conectar(base, a.trip_id, a.token);
    await c.hasta("head_seq");
    expect(e.canal.conexiones()).toBe(1);
    expect(e.contador("sse_aperturas", {})).toBe(1);
    expect(e.metricas.resumen().valores.find((v) => v.nombre === "sse_conexiones")?.valor).toBe(1);
    c.cerrar();
    for (let i = 0; i < 40 && e.canal.conexiones() > 0; i++) await new Promise((ok) => setTimeout(ok, 25));
    expect(e.canal.conexiones()).toBe(0);
    expect(e.registro.entradas.map((x) => x.evento)).toEqual(expect.arrayContaining(["canal_abierto", "canal_cerrado"]));
    expect(e.metricas.resumen().valores.find((v) => v.nombre === "sse_conexiones")?.valor).toBe(0);
    await e.app.close();
  });

  it("la respuesta no pasa por el cierre normal del pedido y al cerrar se limpia el latido", async () => {
    const creados: unknown[] = [];
    const limpiados: unknown[] = [];
    const setReal = globalThis.setInterval;
    const clearReal = globalThis.clearInterval;
    const espiaSet = vi.spyOn(globalThis, "setInterval").mockImplementation(((...args: Parameters<typeof setInterval>) => {
      const t = setReal(...args);
      if (args[1] === 20_000 || args[1] === 77) creados.push(t);
      return t;
    }) as typeof setInterval);
    const espiaClear = vi.spyOn(globalThis, "clearInterval").mockImplementation(((t: Parameters<typeof clearInterval>[0]) => {
      limpiados.push(t);
      return clearReal(t);
    }) as typeof clearInterval);
    try {
      const { e, base, a } = await servidor({ latidoMs: 77 });
      const c = await conectar(base, a.trip_id, a.token);
      await c.hasta("head_seq");
      expect(creados).toHaveLength(1);
      c.cerrar();
      for (let i = 0; i < 40 && e.canal.conexiones() > 0; i++) await new Promise((ok) => setTimeout(ok, 25));
      expect(limpiados).toContain(creados[0]);
      expect(e.registro.entradas.some((x) => x.evento === "pedido" && x.campos.ruta === "/v1/trips/:trip/events")).toBe(false);
      await e.app.close();
    } finally {
      espiaSet.mockRestore();
      espiaClear.mockRestore();
    }
  });

  it("apagar el servidor cierra los canales abiertos enseguida, sin esperar el plazo", async () => {
    const { e, base, a } = await servidor();
    const c = await conectar(base, a.trip_id, a.token);
    await c.hasta("head_seq");
    const inicio = Date.now();
    await e.app.close();
    expect(Date.now() - inicio).toBeLessThan(1500);
    expect(e.canal.conexiones()).toBe(0);
  });
});
