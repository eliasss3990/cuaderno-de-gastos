import Fastify from "fastify";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OCULTO } from "../../src/observabilidad/registro.js";
import { crearRegistroPino } from "../../src/observabilidad/registroPino.js";

/** Un destino que junta lo escrito: cada línea es un JSON. */
function destino() {
  const lineas: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lineas.push(...chunk.toString().split("\n").filter((l) => l !== ""));
      cb();
    },
  });
  return { stream, lineas, json: () => lineas.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe("registro sobre pino", () => {
  it("escribe una línea JSON por evento con el nombre, el nivel, el servicio y la hora ISO, sin pid ni hostname", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    reg.info("ops_recibidas", { cantidad: 3 });
    const [linea] = d.json();
    expect(linea).toMatchObject({ evento: "ops_recibidas", nivel: "info", servicio: "cuaderno-server", cantidad: 3 });
    expect(linea!.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(linea).not.toHaveProperty("pid");
    expect(linea).not.toHaveProperty("hostname");
    expect(linea).not.toHaveProperty("level");
    expect(linea).not.toHaveProperty("msg");
  });

  it("escribe los cuatro niveles con su etiqueta", () => {
    const d = destino();
    const reg = crearRegistroPino({ nivel: "debug", destino: d.stream });
    reg.debug("a");
    reg.info("b");
    reg.warn("c");
    reg.error("d");
    expect(d.json().map((l) => [l.evento, l.nivel])).toEqual([["a", "debug"], ["b", "info"], ["c", "warn"], ["d", "error"]]);
  });

  it("respeta el nivel: por defecto info (sin debug), warn descarta info, silent no escribe nada", () => {
    const porDefecto = destino();
    const a = crearRegistroPino({ destino: porDefecto.stream });
    a.debug("no");
    a.info("si");
    expect(porDefecto.json().map((l) => l.evento)).toEqual(["si"]);

    const warn = destino();
    const b = crearRegistroPino({ nivel: "warn", destino: warn.stream });
    b.info("no");
    b.warn("si");
    b.error("si2");
    expect(warn.json().map((l) => l.evento)).toEqual(["si", "si2"]);

    const nada = destino();
    const c = crearRegistroPino({ nivel: "silent", destino: nada.stream });
    c.error("no");
    expect(nada.lineas).toEqual([]);
  });

  it("limpia los campos en los cuatro niveles: lo prohibido no aparece en ningún lugar de la línea", () => {
    const d = destino();
    const reg = crearRegistroPino({ nivel: "debug", destino: d.stream });
    for (const nivel of ["debug", "info", "warn", "error"] as const) reg[nivel]("evento", { token: "TOKEN-SECRETO", detalle: { nota: "NOTA-SECRETA" } });
    expect(d.lineas).toHaveLength(4);
    for (const l of d.lineas) {
      expect(l).not.toContain("TOKEN-SECRETO");
      expect(l).not.toContain("NOTA-SECRETA");
    }
    expect(d.json().map((l) => l.nivel)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("limpia los campos antes de escribir: lo prohibido no aparece en ningún lugar de la línea", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    reg.warn("rechazo", { token: "TOKEN-SECRETO", payload: { nota: "NOTA-SECRETA" }, detalle: { codigo: "CODIGO-SECRETO", monto: 99887766 }, motivo: "viaje_cerrado" });
    const linea = d.lineas[0]!;
    for (const secreto of ["TOKEN-SECRETO", "NOTA-SECRETA", "CODIGO-SECRETO", "99887766"]) expect(linea).not.toContain(secreto);
    expect(d.json()[0]).toMatchObject({ token: OCULTO, payload: OCULTO, detalle: { codigo: OCULTO, monto: OCULTO }, motivo: "viaje_cerrado" });
  });

  it("un hijo agrega sus campos a todo lo que escribe, los acumula y no cambia al padre", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    const hijo = reg.hijo({ trip_id: "0193b4c2" });
    const nieto = hijo.hijo({ device_id: "0193b4c3" });
    reg.info("padre");
    hijo.info("hijo", { n: 1 });
    nieto.error("nieto");
    const [p, h, n] = d.json();
    expect(p).not.toHaveProperty("trip_id");
    expect(h).toMatchObject({ evento: "hijo", trip_id: "0193b4c2", n: 1 });
    expect(h).not.toHaveProperty("device_id");
    expect(n).toMatchObject({ evento: "nieto", trip_id: "0193b4c2", device_id: "0193b4c3" });
  });

  it("los campos de un hijo también se limpian", () => {
    const d = destino();
    const hijo = crearRegistroPino({ destino: d.stream }).hijo({ token: "TOKEN-SECRETO", trip_id: "abc" });
    hijo.info("x");
    expect(d.lineas[0]).not.toContain("TOKEN-SECRETO");
    expect(d.json()[0]).toMatchObject({ token: OCULTO, trip_id: "abc" });
  });

  it("una clave __proto__ en los campos (de un evento o de un hijo) no cambia ningún prototipo y no rompe el log", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    const hostil = () => JSON.parse('{"__proto__":{"inyectado":true},"normal":1}') as Record<string, unknown>;
    reg.info("evento", hostil());
    reg.hijo(hostil()).info("del_hijo");
    expect(({} as Record<string, unknown>).inyectado).toBeUndefined();
    expect(d.json().map((l) => [l.evento, l.normal])).toEqual([["evento", 1], ["del_hijo", 1]]);
  });

  it("un error sale con la misma forma (type, message, stack) por nuestro registro, con cualquier clave, y por pino directo como lo escribe Fastify", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    reg.error("uno", { err: new RangeError("uno") });
    reg.error("dos", { fallo: new RangeError("dos") });
    reg.pino.error({ err: new TypeError("tres") }, "tres");
    const [a, b, c] = d.json() as { err?: Record<string, string>; fallo?: Record<string, string> }[];
    expect(a!.err).toMatchObject({ type: "RangeError", message: "uno" });
    expect(a!.err).not.toHaveProperty("name");
    expect(b!.fallo).toMatchObject({ type: "RangeError", message: "dos" });
    expect(c!.err).toMatchObject({ type: "TypeError", message: "tres" });
    expect(a!.err!.stack).toContain("RangeError");
    expect(c!.err!.stack).toContain("TypeError");
  });

  it("un error real que escribe Fastify (por pino directo) sale limpio: sin propiedades ajenas, con el mensaje redactado y con su código", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    const err = Object.assign(new Error("fallo con Bearer abc123def"), { code: "ECONNRESET", token: "TOKEN-SECRETO", headers: { authorization: "SECRETO-H" }, cause: new Error("causa-secreta") });
    reg.pino.error({ err }, "directo");
    expect(d.lineas[0]).not.toContain("abc123def");
    for (const s of ["TOKEN-SECRETO", "SECRETO-H"]) expect(d.lineas[0]).not.toContain(s);
    const e = (d.json()[0] as { err: Record<string, unknown> }).err;
    expect(e).toMatchObject({ type: "Error", message: "fallo con Bearer [oculto]", code: "ECONNRESET" });
    expect(Object.keys(e).sort()).toEqual(["cause", "code", "message", "stack", "type"]);
    expect(e.cause).toMatchObject({ type: "Error", message: "causa-secreta" });
  });

  it("un campo con el nombre de una clave que escribe el registro se renombra y la clave no se duplica", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    reg.info("mio", { evento: "otro", servicio: "s", nivel: "n", time: "t", normal: 1 });
    reg.hijo({ evento: "del_hijo" }).warn("hijo");
    const [a, b] = d.json();
    expect(a).toMatchObject({ evento: "mio", servicio: "cuaderno-server", nivel: "info", campo_evento: "otro", campo_servicio: "s", campo_nivel: "n", campo_time: "t", normal: 1 });
    expect(a!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(b).toMatchObject({ evento: "hijo", nivel: "warn", campo_evento: "del_hijo" });
    for (const clave of ["evento", "servicio", "nivel", "time"]) expect(d.lineas[0]!.split(`"${clave}":`).length).toBe(2); // una sola vez por línea
  });

  it("con el nivel apagado no se leen ni se limpian los campos (y con el nivel encendido sí)", () => {
    const d = destino();
    let lecturas = 0;
    const campos = { get dato(): number { lecturas += 1; return 1; } };
    const reg = crearRegistroPino({ nivel: "warn", destino: d.stream });
    reg.debug("no", campos);
    reg.info("no", campos);
    expect(lecturas).toBe(0);
    reg.warn("si", campos);
    expect(lecturas).toBe(1);
    reg.error("si", campos);
    expect(lecturas).toBe(2);
    const silencioso = crearRegistroPino({ nivel: "silent", destino: d.stream });
    silencioso.error("no", campos);
    expect(lecturas).toBe(2);
  });

  it("la segunda defensa oculta las cabeceras sensibles en req, res y sueltas", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    const cabeceras = { authorization: "S1", cookie: "S2", "x-token": "S3", "x-api-key": "S4", "proxy-authorization": "S5", "set-cookie": "S6", host: "visible" };
    for (const lugar of ["req", "res"]) reg.pino.info({ [lugar]: { headers: { ...cabeceras } } }, lugar);
    reg.pino.info({ headers: { ...cabeceras } }, "sueltas");
    for (const l of d.lineas) {
      for (const s of ["S1", "S2", "S3", "S4", "S5", "S6"]) expect(l).not.toContain(`"${s}"`);
      expect(l).toContain("visible");
    }
    expect(d.json()).toHaveLength(3);
  });

  it("no lanza con campos que no se pueden serializar", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    const circular: Record<string, unknown> = {};
    circular.yo = circular;
    expect(() => reg.info("raro", { circular, g: 10n, f: () => 1 })).not.toThrow();
    expect(d.json()).toHaveLength(1);
  });

  it("la instancia de pino oculta las cabeceras sensibles aunque alguien las escriba sin pasar por limpiarCampos", () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    reg.pino.info({ req: { headers: { authorization: "Bearer SECRETO", cookie: "SECRETO", host: "x" } } }, "directo");
    expect(d.lineas[0]).not.toContain("SECRETO");
    expect(d.json()[0]).toMatchObject({ req: { headers: { authorization: OCULTO, cookie: OCULTO, host: "x" } } });
    reg.pino.info({ headers: { authorization: "Bearer SECRETO", cookie: "SECRETO", host: "y" } }, "directo_sin_req");
    expect(d.lineas[1]).not.toContain("SECRETO");
    expect(d.json()[1]).toMatchObject({ headers: { authorization: OCULTO, cookie: OCULTO, host: "y" } });
  });
});

describe("Fastify escribe por el mismo registro", () => {
  it("los mensajes de cada pedido salen con el mismo formato y sin la cabecera Authorization", async () => {
    const d = destino();
    const reg = crearRegistroPino({ destino: d.stream });
    const app = Fastify({ loggerInstance: reg.pino });
    app.get("/ping", async () => ({ ok: true }));
    const r = await app.inject({ method: "GET", url: "/ping", headers: { authorization: "Bearer TOKEN-SECRETO", cookie: "SESION-SECRETA" } });
    expect(r.statusCode).toBe(200);
    await app.close();
    const eventos = d.json().map((l) => l.evento);
    expect(eventos).toContain("incoming request");
    expect(eventos).toContain("request completed");
    expect(d.json().every((l) => l.servicio === "cuaderno-server" && l.nivel !== undefined)).toBe(true);
    const todo = d.lineas.join("\n");
    expect(todo).not.toContain("TOKEN-SECRETO");
    expect(todo).not.toContain("SESION-SECRETA");
  });
});

describe("pino queda detrás de la interfaz", () => {
  it("ningún archivo de src fuera de registroPino.ts importa pino", () => {
    const raiz = fileURLToPath(new URL("../../src/", import.meta.url));
    const archivos = readdirSync(raiz, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    expect(archivos.length).toBeGreaterThan(10);
    const culpables = archivos.filter((f) => f !== join("observabilidad", "registroPino.ts") && /from\s+["']pino["']|require\(["']pino["']\)/.test(readFileSync(join(raiz, f), "utf8")));
    expect(culpables).toEqual([]);
  });
});
