import { describe, expect, it } from "vitest";
import type { ServicioDeIdentidad } from "../../src/dominio/identidad/servicioIdentidad.js";
import { entornoApi, NUEVO, VIAJE } from "../ayudas/entornoApi.js";

describe("el registro de cada pedido", () => {
  it("escribe un evento `pedido` con el método, la plantilla de la ruta, el estado y la duración", async () => {
    const e = entornoApi();
    await e.crearViaje();
    const p = e.registro.entradas.find((x) => x.evento === "pedido");
    expect(p?.nivel).toBe("info");
    expect(p?.campos).toMatchObject({ metodo: "POST", ruta: "/v1/trips", estado: 201 });
    expect(typeof p?.campos.ms).toBe("number");
    expect(p?.campos.ms as number).toBeGreaterThanOrEqual(0);
    expect(p?.campos.req_id).toMatch(/^[0-9a-f]{8}$/);
    expect(p?.campos).not.toHaveProperty("trip_id"); // sin token no hay dispositivo
    expect(p?.campos).not.toHaveProperty("error");
  });

  it("la duración es lo que pasó entre que empezó y terminó el pedido, con un decimal (reloj propio)", async () => {
    let t = 1000;
    const e = entornoApi({ reloj: () => (t += 7.25) }); // cada lectura avanza 7,25 ms: el pedido lee el reloj dos veces
    await e.app.inject({ method: "GET", url: "/healthz" });
    const p = e.registro.entradas.find((x) => x.evento === "pedido");
    expect(p?.campos.ms).toBe(7.3);
    expect(e.metricas.resumen().mediciones.find((s) => s.nombre === "http_pedido_ms")).toMatchObject({ cantidad: 1, minimo: 7.3, maximo: 7.3 });
  });

  it("con el reloj por defecto mide el tiempo real: una ruta que tarda 30 ms se registra con al menos 25", async () => {
    const e = entornoApi();
    e.app.get("/lenta", async () => {
      await new Promise((resolver) => setTimeout(resolver, 30));
      return {};
    });
    await e.app.inject({ method: "GET", url: "/lenta" });
    const p = e.registro.entradas.find((x) => x.evento === "pedido");
    expect(p?.campos.ms as number).toBeGreaterThanOrEqual(25);
    expect(e.metricas.resumen().mediciones.find((s) => s.nombre === "http_pedido_ms")?.minimo).toBeGreaterThanOrEqual(25);
  });

  it("registra la ruta por plantilla, nunca con los identificadores reales, y el viaje y el dispositivo abreviados a 8 caracteres", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    await e.invitar(org.token, org.trip_id);
    const p = e.registro.entradas.filter((x) => x.evento === "pedido").at(-1);
    expect(p?.campos).toMatchObject({ metodo: "POST", ruta: "/v1/trips/:trip/invitations", estado: 201, trip_id: org.trip_id.slice(0, 8), device_id: org.device_id.slice(0, 8) });
    const todo = JSON.stringify(e.registro.entradas);
    for (const entero of [org.trip_id, org.device_id, org.member_id]) expect(todo).not.toContain(entero);
  });

  it("los pedidos con error del cliente (400, 401, 404) se registran como info, no como error", async () => {
    const e = entornoApi();
    await e.unirse("ABCDEFGH");
    await e.app.inject({ method: "POST", url: "/v1/trips/x/invitations", payload: {} });
    await e.app.inject({ method: "GET", url: "/nada" });
    const p = e.registro.entradas.filter((x) => x.evento === "pedido");
    expect(p.map((x) => [x.campos.estado, x.nivel])).toEqual([[400, "info"], [401, "info"], [404, "info"]]);
  });

  it("anota el código del error cuando lo hay", async () => {
    const e = entornoApi();
    await e.unirse("ABCDEFGH");
    const p = e.registro.entradas.find((x) => x.evento === "pedido");
    expect(p?.campos).toMatchObject({ ruta: "/v1/join", estado: 400, error: "codigo_invalido" });
  });

  it("un pedido a una ruta que no existe se registra como `sin_ruta`", async () => {
    const e = entornoApi();
    await e.app.inject({ method: "GET", url: "/v1/lo/que/sea?code=ABCD2345" });
    const p = e.registro.entradas.find((x) => x.evento === "pedido");
    expect(p?.campos).toMatchObject({ ruta: "sin_ruta", estado: 404, error: "no_existe" });
    expect(JSON.stringify(e.registro.entradas)).not.toContain("ABCD2345");
  });

  it("la salud va a debug (Docker la consulta cada 30 s) y un 500 a error", async () => {
    const e = entornoApi();
    await e.app.inject({ method: "GET", url: "/healthz" });
    const salud = e.registro.entradas.filter((x) => x.evento === "pedido");
    expect(salud.map((x) => x.nivel)).toEqual(["debug"]);

    const roto = { crearViaje: () => { throw new Error("boom"); } } as unknown as ServicioDeIdentidad;
    const f = entornoApi({ servicio: roto });
    await f.app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE });
    const p = f.registro.entradas.find((x) => x.evento === "pedido");
    expect([p?.nivel, p?.campos.estado, p?.campos.error]).toEqual(["error", 500, "error_interno"]);
  });

  it("cada pedido tiene su propio req_id, que el cliente no puede elegir", async () => {
    const e = entornoApi();
    await e.app.inject({ method: "GET", url: "/healthz", headers: { "x-request-id": "forjado-por-el-cliente" } });
    await e.app.inject({ method: "GET", url: "/healthz" });
    const ids = e.registro.entradas.map((x) => x.campos.req_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(JSON.stringify(e.registro.entradas)).not.toContain("forjado");
  });

  it("nunca escribe tokens, códigos de invitación, ni lo que el cliente manda (nombres, apodos, cabeceras)", async () => {
    const e = entornoApi();
    const org = await e.crearViaje({ ...VIAJE, nombre_dispositivo: "Dispositivo-Privado-Uno" });
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    const ana = await e.unirse(cuerpo.codigo, { ...NUEVO, apodo: "Apodo-Privado-Ana" });
    await e.unirse("ZZZZ9999", NUEVO, { "x-real-ip": "203.0.113.77", "x-app-version": "9.9.9-secreto" });
    await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con("token-falso-de-prueba-123"), payload: {} });
    const todo = JSON.stringify(e.registro.entradas);
    for (const secreto of [org.token, ana.json<{ token: string }>().token, cuerpo.codigo, "ZZZZ9999", "Dispositivo-Privado-Uno", "Apodo-Privado-Ana", "token-falso-de-prueba-123", "203.0.113.77", "secreto"]) {
      expect([secreto, todo.includes(secreto)]).toEqual([secreto, false]);
    }
  });
});

describe("las métricas de cada pedido", () => {
  it("cuenta los pedidos por método, plantilla de ruta y estado, y mide su duración por método y ruta", async () => {
    const e = entornoApi();
    await e.crearViaje();
    await e.crearViaje();
    await e.unirse("ABCDEFGH");
    expect(e.contador("http_pedidos", { metodo: "POST", ruta: "/v1/trips", estado: "201" })).toBe(2);
    expect(e.contador("http_pedidos", { metodo: "POST", ruta: "/v1/join", estado: "400" })).toBe(1);
    const medida = e.metricas.resumen().mediciones.find((s) => s.nombre === "http_pedido_ms" && s.etiquetas.ruta === "/v1/trips");
    expect(medida).toMatchObject({ cantidad: 2, etiquetas: { metodo: "POST", ruta: "/v1/trips" } });
    expect(medida!.minimo).toBeGreaterThanOrEqual(0);
  });

  it("las rutas con parámetros se cuentan por plantilla (una sola serie), y las que no existen como `sin_ruta`", async () => {
    const e = entornoApi();
    const a = await e.crearViaje();
    const b = await e.crearViaje();
    await e.invitar(a.token, a.trip_id);
    await e.invitar(b.token, b.trip_id);
    await e.app.inject({ method: "GET", url: "/no/existe" });
    await e.app.inject({ method: "GET", url: "/otra/cosa" });
    expect(e.contador("http_pedidos", { metodo: "POST", ruta: "/v1/trips/:trip/invitations", estado: "201" })).toBe(2);
    expect(e.contador("http_pedidos", { metodo: "GET", ruta: "sin_ruta", estado: "404" })).toBe(2);
    const series = e.metricas.resumen().contadores.map((s) => JSON.stringify(s.etiquetas));
    expect(series.some((s) => s.includes(a.trip_id))).toBe(false);
  });
});

describe("la IP del cliente para limitar los intentos de unirse", () => {
  const fallar = async (e: ReturnType<typeof entornoApi>, n: number, cabeceras: Record<string, string>, remoteAddress?: string) => {
    for (let i = 0; i < n; i++) await e.app.inject({ method: "POST", url: "/v1/join", headers: cabeceras, ...(remoteAddress === undefined ? {} : { remoteAddress }), payload: { codigo: "ABCDEFGH", ...NUEVO } });
  };
  const estado = async (e: ReturnType<typeof entornoApi>, cabeceras: Record<string, string>, remoteAddress?: string) =>
    (await e.app.inject({ method: "POST", url: "/v1/join", headers: cabeceras, ...(remoteAddress === undefined ? {} : { remoteAddress }), payload: { codigo: "ABCDEFGH", ...NUEVO } })).statusCode;

  it("usa X-Real-IP (que nginx pone desde Cloudflare): con 5 fallos de la misma IP el siguiente es 429 y otra IP no se ve afectada", async () => {
    const e = entornoApi();
    await fallar(e, 5, { "x-real-ip": "203.0.113.1" }, "10.0.0.1");
    expect(await estado(e, { "x-real-ip": "203.0.113.1" }, "10.0.0.2")).toBe(429); // el socket cambia, la IP real no
    expect(await estado(e, { "x-real-ip": "203.0.113.2" }, "10.0.0.1")).toBe(400); // la IP real cambia, el socket no
  });

  it("sin X-Real-IP o con una vacía usa la dirección del socket", async () => {
    const e = entornoApi();
    await fallar(e, 5, {}, "198.51.100.7");
    expect(await estado(e, {}, "198.51.100.7")).toBe(429);
    expect(await estado(e, { "x-real-ip": "  " }, "198.51.100.7")).toBe(429);
    expect(await estado(e, {}, "198.51.100.8")).toBe(400);
  });

  it("un X-Real-IP que no es una IP (basura, una lista `a, b`) se ignora y se usa la del socket: no se puede agotar un cupo ajeno", async () => {
    const e = entornoApi();
    await fallar(e, 5, { "x-real-ip": "basura" }, "10.0.0.2");
    expect(await estado(e, { "x-real-ip": "a, b" }, "10.0.0.2")).toBe(429); // la misma del socket
    expect(await estado(e, { "x-real-ip": "198.51.100.1, 10.0.0.1" }, "10.0.0.2")).toBe(429);
    expect(await estado(e, { "x-real-ip": "basura" }, "10.0.0.3")).toBe(400); // otro socket: sin bloquear
    expect(await estado(e, { "x-real-ip": "otra-basura" }, "10.0.0.4")).toBe(400);
  });

  it("una IP válida con espacios alrededor o una IPv6 del mismo /64 comparten el cupo de la IP", async () => {
    const e = entornoApi();
    await fallar(e, 5, { "x-real-ip": "203.0.113.9" }, "10.0.0.1");
    expect(await estado(e, { "x-real-ip": "  203.0.113.9  " }, "10.0.0.2")).toBe(429);
    await fallar(e, 5, { "x-real-ip": "2001:db8:0:1::5" }, "10.0.0.1");
    expect(await estado(e, { "x-real-ip": "2001:db8:0:1::99" }, "10.0.0.2")).toBe(429);
    expect(await estado(e, { "x-real-ip": "2001:db8:0:2::5" }, "10.0.0.2")).toBe(400); // otro /64
  });
});

describe("los errores del enrutador (URL mal codificada, parámetro larguísimo)", () => {
  const urls = ["/v1/trips/%ff/devices/x/revoke", `/v1/trips/${"x".repeat(300)}/invitations`];

  it("también llevan Cache-Control, se registran como pedido y se cuentan una sola vez", async () => {
    for (const url of urls) {
      const e = entornoApi();
      const r = await e.app.inject({ method: "POST", url, headers: { authorization: "Bearer x" }, payload: {} });
      expect([url.slice(0, 20), r.statusCode, r.headers["cache-control"]]).toEqual([url.slice(0, 20), 400, "private, no-store"]);
      const p = e.registro.entradas.filter((x) => x.evento === "pedido");
      expect(p).toHaveLength(1);
      expect(p[0]?.campos).toMatchObject({ metodo: "POST", ruta: "sin_ruta", estado: 400, error: "formato_invalido" });
      expect(p[0]?.campos.req_id).toMatch(/^[0-9a-f]{8}$/);
      expect(e.contador("http_pedidos", { metodo: "POST", ruta: "sin_ruta", estado: "400" })).toBe(1);
      expect(e.metricas.resumen().mediciones.find((s) => s.nombre === "http_pedido_ms")?.cantidad).toBe(1);
      expect(JSON.stringify(e.registro.entradas)).not.toContain("%ff");
    }
  });
});

describe("el límite del cuerpo es de 16 KB en todas las rutas", () => {
  it("también en las que no leen el cuerpo (revocar): más de 16 KB es 400 con el mensaje genérico", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const url = `/v1/trips/${org.trip_id}/devices/${org.device_id}/revoke`;
    const r = await e.app.inject({ method: "POST", url, headers: { ...e.con(org.token), "content-type": "text/plain" }, payload: "x".repeat(20 * 1024) });
    expect([r.statusCode, (r.json() as { error: { mensaje: string } }).error.mensaje]).toEqual([400, "el pedido no es válido"]);
    const chico = await e.app.inject({ method: "POST", url, headers: { ...e.con(org.token), "content-type": "text/plain" }, payload: "x".repeat(10 * 1024) });
    expect(chico.statusCode).toBe(204);
  });
});

describe("la salud", () => {
  it("GET /healthz responde {estado:ok} sin token", async () => {
    const { app } = entornoApi();
    const r = await app.inject({ method: "GET", url: "/healthz" });
    expect([r.statusCode, r.json()]).toEqual([200, { estado: "ok" }]);
  });
});

describe("las respuestas no se guardan en cachés (Cache-Control: private, no-store)", () => {
  it("lo llevan los éxitos, los errores y la salud", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const respuestas = [
      await e.app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE }),
      await e.app.inject({ method: "POST", url: "/v1/trips", payload: {} }),
      await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(org.token), payload: {} }),
      await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/devices/${org.device_id}/revoke`, headers: e.con(org.token) }),
      await e.app.inject({ method: "POST", url: "/v1/trips/x/invitations", payload: {} }),
      await e.app.inject({ method: "GET", url: "/nada" }),
      await e.app.inject({ method: "GET", url: "/healthz" }),
    ];
    expect(respuestas.map((r) => r.statusCode)).toEqual([201, 400, 201, 204, 401, 404, 200]);
    for (const r of respuestas) expect(r.headers["cache-control"]).toBe("private, no-store");
  });

  it("una ruta que ya puso su propio Cache-Control (los adjuntos lo harán) lo conserva", async () => {
    const e = entornoApi();
    e.app.get("/prueba-cache", (_request, reply) => reply.header("cache-control", "private, max-age=60, immutable").send("x"));
    const r = await e.app.inject({ method: "GET", url: "/prueba-cache" });
    expect(r.headers["cache-control"]).toBe("private, max-age=60, immutable");
  });
});
