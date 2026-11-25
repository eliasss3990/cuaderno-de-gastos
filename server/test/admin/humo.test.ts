import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPERA_DE_HUMO_MS, FalloDeHumo, humo } from "../../src/admin/humo.js";
import { abrirBase } from "../../src/almacen/base/base.js";
import { principal, SALIDA_ERROR, SALIDA_OK } from "../../src/admin/principal.js";
import { arrancar, type Servidor } from "../../src/arranque.js";
import { RegistroDeMemoria } from "../ayudas/registroDeMemoria.js";

const PEPPER = "a".repeat(64);
const carpetas: string[] = [];
const servidores: Servidor[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const s of servidores.splice(0)) await s.detener();
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

async function conServidor() {
  const dir = mkdtempSync(join(tmpdir(), "humo-"));
  carpetas.push(dir);
  mkdirSync(join(dir, "datos"));
  mkdirSync(join(dir, "adjuntos"));
  writeFileSync(join(dir, "pepper.txt"), PEPPER);
  const config = { puerto: 0, dirDatos: join(dir, "datos"), dirAdjuntos: join(dir, "adjuntos"), archivoPepper: join(dir, "pepper.txt"), nivelDeLog: "silent" as const, aceptarPepperNuevo: false };
  const servidor = await arrancar(config, { registro: new RegistroDeMemoria() });
  servidores.push(servidor);
  const env = { PORT: String(servidor.puerto), DATA_DIR: config.dirDatos, ADJUNTOS_DIR: config.dirAdjuntos, PEPPER_FILE: config.archivoPepper };
  const correr = async (argv: string[], pedir?: typeof fetch) => {
    const salida: string[] = [];
    const error: string[] = [];
    const codigo = await principal(argv, env, { salida: (l) => salida.push(l), error: (l) => error.push(l) }, Date.now, pedir);
    return { codigo, salida, error };
  };
  return { correr, puerto: servidor.puerto, dir };
}

describe("humo contra el servidor real", () => {
  it("crea un viaje humo-, sube y baja una operación, comprueba la salud y no deja nada", async () => {
    const s = await conServidor();
    const r = await s.correr(["humo"]);
    expect(r.error).toEqual([]);
    expect(r.codigo).toBe(SALIDA_OK);
    expect(r.salida[0]).toBe("salud: ok");
    expect(r.salida[1]).toMatch(/^viaje creado: humo-\d{4}-\d{2}-\d{2}T/);
    expect(r.salida.slice(2)).toEqual(["operación subida", "operación bajada", "viaje de humo borrado", "humo: ok"]);
    expect((await s.correr(["viajes"])).salida).toEqual(["no hay viajes"]);
    expect((await s.correr(["verificar"])).salida).toEqual(["verificar: ok"]);
    expect(r.salida.join(" ")).not.toMatch(/token|Bearer/i);
  });

  it("si un paso falla, sale con 1, dice cuál y borra igual el viaje de humo", async () => {
    const s = await conServidor();
    const roto: typeof fetch = async (url, init) => {
      if (String(url).includes("/changes")) return new Response("{}", { status: 500 });
      return fetch(url, init);
    };
    const r = await s.correr(["humo"], roto);
    expect(r.codigo).toBe(SALIDA_ERROR);
    expect(r.error).toEqual(["humo: bajar: respondió 500 (se esperaba 200)"]);
    expect((await s.correr(["viajes"])).salida).toEqual(["no hay viajes"]);
  });

  it("una subida rechazada o una bajada sin la operación cuentan como fallo, y el viaje se borra igual", async () => {
    const s = await conServidor();
    const rechaza: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/ops")) return Response.json({ resultados: [{ estado: "rejected", razon: "formato" }] });
      return fetch(url, init);
    };
    expect((await s.correr(["humo"], rechaza)).error).toEqual(["humo: subir: la operación quedó rejected (formato)"]);
    const sinLaOp: typeof fetch = async (url, init) => {
      if (String(url).includes("/changes")) return Response.json({ ops: [{ op_id: "otra" }] });
      return fetch(url, init);
    };
    expect((await s.correr(["humo"], sinLaOp)).error).toEqual(["humo: bajar: la operación subida no aparece en /changes"]);
    expect((await s.correr(["viajes"])).salida).toEqual(["no hay viajes"]);
  });

  it("si el servidor explica el error, humo lo muestra", async () => {
    const s = await conServidor();
    const explica: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/v1/trips")) return Response.json({ error: { codigo: "formato_invalido", mensaje: "zona_horaria: no sirve" } }, { status: 400 });
      return fetch(url, init);
    };
    expect((await s.correr(["humo"], explica)).error).toEqual(["humo: crear el viaje: respondió 400 (se esperaba 201): zona_horaria: no sirve"]);
  });

  it("cargar-ejemplo con alguna rechazada sale con 1 y lo dice en la salida de error", async () => {
    const s = await conServidor();
    const alta = (await (
      await fetch(`http://127.0.0.1:${s.puerto}/v1/trips`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: "ejemplo-cli", zona_horaria: "America/Asuncion", monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }], nombre_dispositivo: "Celu", apodo: "Papá", color: "#E8E4F3", emoji: "🧔" }),
      })
    ).json()) as { trip_id: string };
    const archivo = join(s.dir, "ej.json");
    writeFileSync(archivo, JSON.stringify({ ops: [{ type: "category.create", entity_type: "category", entity_id: "018f3a6e-7000-7000-8000-000000000001", payload: {} }] }));
    const r = await s.correr(["cargar-ejemplo", "--viaje", alta.trip_id, "--archivo", archivo]);
    expect([r.codigo, r.salida, r.error]).toEqual([SALIDA_ERROR, [], ["cargadas 0 de 1 operaciones en ejemplo-cli", "operación 1 (category.create): formato"]]);
  });

  it("con el reloj congelado (el servidor crea el viaje en el mismo milisegundo) la operación de humo no choca con las del alta", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_802_000_000_000 });
    const s = await conServidor();
    const r = await s.correr(["humo"]);
    expect([r.codigo, r.error]).toEqual([SALIDA_OK, []]);
  });

  it("si falla un paso y también el borrado, informa los dos y cómo borrar el viaje a mano", async () => {
    const db = abrirBase(":memory:");
    const falso: typeof fetch = async (url) => {
      const u = String(url);
      if (u.endsWith("/healthz")) return Response.json({ estado: "ok" });
      if (u.endsWith("/v1/trips")) return Response.json({ trip_id: "018f3a6e-1000-7000-8000-0000000000aa", device_id: "018f3a6e-0000-7000-8000-00000000000a", token: "t" }, { status: 201 });
      return Response.json({ resultados: [{ estado: "rejected", razon: "formato" }] });
    };
    const error = await humo({ db, puerto: 1, dirAdjuntos: "/no-se-usa", ahora: () => 1_802_000_000_000, pedir: falso }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FalloDeHumo);
    expect((error as Error).message).toBe(
      "subir: la operación quedó rejected (formato); no se pudo borrar el viaje 018f3a6e-1000-7000-8000-0000000000aa (borrarlo con borrar-viaje --id 018f3a6e-1000-7000-8000-0000000000aa): el viaje no existe",
    );
  });

  it("un pedido que no responde corta en el tiempo límite con un fallo claro", async () => {
    const colgado: typeof fetch = async (_url, init) =>
      new Promise((_ok, falla) => init?.signal?.addEventListener("abort", () => falla(init.signal?.reason as Error)));
    expect(ESPERA_DE_HUMO_MS).toBe(10_000);
    const db = abrirBase(":memory:");
    const error = await humo({ db, puerto: 1, dirAdjuntos: "/no-se-usa", ahora: () => 1_802_000_000_000, pedir: colgado, esperaMs: 50 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FalloDeHumo);
    expect((error as Error).message).toBe("/healthz: no respondió en 50 ms");
  });

  it("si la salud no responde 200, sale con 1 sin crear nada", async () => {
    const s = await conServidor();
    const caido: typeof fetch = async () => new Response("", { status: 503 });
    const r = await s.correr(["humo"], caido);
    expect([r.codigo, r.error]).toEqual([SALIDA_ERROR, ["humo: salud: respondió 503 (se esperaba 200)"]]);
  });

  it("verificar, borrar-viaje y cargar-ejemplo por la línea de comandos: problemas a la salida de error con 1", async () => {
    const s = await conServidor();
    const borrar = await s.correr(["borrar-viaje", "--id", "018f3a6e-1000-7000-8000-0000000000ff"]);
    expect([borrar.codigo, borrar.error]).toEqual([SALIDA_ERROR, ["el viaje no existe"]]);
    const verificar = await s.correr(["verificar", "--archivo", "/no/existe.sqlite"]);
    expect(verificar.codigo).toBe(SALIDA_ERROR);
    expect(verificar.error[0]).toMatch(/^no se puede abrir el respaldo/);
  });
});
