import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrancar, CADA_DIEZ_MINUTOS_MS, iniciarMantenimiento, NOMBRE_DE_LA_BASE, PLAZO_DE_APAGADO_MS, type Servidor } from "../src/arranque.js";
import type { Configuracion } from "../src/configuracion.js";
import { ErrorDeConfiguracion } from "../src/configuracion.js";
import { RegistroDeMemoria } from "./ayudas/registroDeMemoria.js";
import { entornoApi, NUEVO, VIAJE } from "./ayudas/entornoApi.js";

const PEPPER_A = "a".repeat(64);
const PEPPER_B = "b".repeat(64);
const carpetas: string[] = [];
const servidores: Servidor[] = [];
afterEach(async () => {
  for (const s of servidores.splice(0)) await s.detener();
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

/** Una carpeta temporal con el archivo del pepper y, salvo que se pida lo contrario, la carpeta de datos creada. */
function entorno(pepper = PEPPER_A, conDatos = true) {
  const dir = mkdtempSync(join(tmpdir(), "arranque-"));
  carpetas.push(dir);
  const archivoPepper = join(dir, "pepper.txt");
  writeFileSync(archivoPepper, pepper);
  const datos = join(dir, "datos");
  if (conDatos) mkdirSync(datos);
  const adjuntos = join(dir, "adjuntos");
  mkdirSync(adjuntos);
  return { dir, datos, adjuntos, archivoPepper };
}
const configuracion = (e: ReturnType<typeof entorno>, extra: Partial<Configuracion> = {}): Configuracion => ({ puerto: 0, dirDatos: e.datos, dirAdjuntos: e.adjuntos, archivoPepper: e.archivoPepper, nivelDeLog: "silent", ...extra });
async function levantar(e: ReturnType<typeof entorno>, extra: Partial<Configuracion> = {}, registro = new RegistroDeMemoria()) {
  const servidor = await arrancar(configuracion(e, extra), { registro });
  servidores.push(servidor);
  return { servidor, registro, url: `http://127.0.0.1:${servidor.puerto}` };
}
const post = (url: string, cuerpo: object, cabeceras: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo) });

describe("arrancar", () => {
  it("escucha de verdad en el puerto pedido, crea la base en DATA_DIR y atiende la salud", async () => {
    const e = entorno();
    const { servidor, url } = await levantar(e);
    expect(servidor.puerto).toBeGreaterThan(0);
    const r = await fetch(`${url}/healthz`);
    expect([r.status, await r.json()]).toEqual([200, { estado: "ok" }]);
    expect(NOMBRE_DE_LA_BASE).toBe("cuaderno.db");
    expect(existsSync(join(e.datos, "cuaderno.db"))).toBe(true);
  });

  it("registra que arrancó y que se detuvo, y detener es seguro de repetir", async () => {
    const e = entorno();
    const { servidor, registro, url } = await levantar(e, { versionMinima: "0.2.0" });
    expect(registro.entradas.find((x) => x.evento === "servidor_iniciado")?.campos).toMatchObject({ puerto: servidor.puerto, version_minima: "0.2.0" });
    const antes = registro.entradas.filter((x) => x.evento === "servidor_detenido").length;
    await servidor.detener();
    await servidor.detener();
    expect(registro.entradas.filter((x) => x.evento === "servidor_detenido").length - antes).toBe(1);
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
  });

  it("al detenerlo cancela sus dos temporizadores (el resumen y el mantenimiento) y cierra la base sin dejar archivos WAL", async () => {
    const e = entorno();
    const espia = vi.spyOn(globalThis, "clearInterval");
    const espiaDelPlazo = vi.spyOn(globalThis, "clearTimeout");
    try {
      const { servidor, url } = await levantar(e);
      await post(`${url}/v1/trips`, VIAJE);
      expect(existsSync(join(e.datos, `${NOMBRE_DE_LA_BASE}-wal`))).toBe(true); // abierta, con la escritura pendiente de checkpoint
      espia.mockClear();
      espiaDelPlazo.mockClear();
      await servidor.detener();
      expect(espia).toHaveBeenCalledTimes(2);
      expect(espiaDelPlazo).toHaveBeenCalled(); // y el temporizador del plazo de apagado
      expect(existsSync(join(e.datos, `${NOMBRE_DE_LA_BASE}-wal`))).toBe(false);
      expect(existsSync(join(e.datos, `${NOMBRE_DE_LA_BASE}-shm`))).toBe(false);
    } finally {
      espia.mockRestore();
      espiaDelPlazo.mockRestore();
    }
  });

  it("al detenerlo deja terminar el pedido que está en curso antes de cerrar la base (un pedido a medio enviar termina bien)", async () => {
    const e = entorno();
    const { servidor } = await levantar(e);
    const cuerpo = JSON.stringify(VIAJE);
    const socket = connect(servidor.puerto, "127.0.0.1");
    const respuesta = new Promise<string>((resolver, rechazar) => {
      let texto = "";
      socket.on("data", (d) => (texto += d.toString()));
      socket.on("end", () => resolver(texto));
      socket.on("error", rechazar);
    });
    await new Promise((resolver) => socket.once("connect", resolver));
    socket.write(`POST /v1/trips HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(cuerpo)}\r\nConnection: close\r\n\r\n${cuerpo.slice(0, 10)}`);
    await new Promise((resolver) => setTimeout(resolver, 100));
    const parada = servidor.detener(); // empieza a detenerse con el pedido a medio enviar
    await new Promise((resolver) => setTimeout(resolver, 150));
    socket.write(cuerpo.slice(10));
    expect((await respuesta).startsWith("HTTP/1.1 201")).toBe(true);
    await parada;
  });

  it("un cliente colgado con un pedido que nunca termina no impide apagar: pasado el plazo se cortan las conexiones", async () => {
    expect(PLAZO_DE_APAGADO_MS).toBe(8000);
    const e = entorno();
    const servidor = await arrancar(configuracion(e), { registro: new RegistroDeMemoria(), plazoDeApagadoMs: 300 });
    servidores.push(servidor);
    const socket = connect(servidor.puerto, "127.0.0.1");
    const cerrada = new Promise<void>((resolver) => socket.on("close", () => resolver()));
    socket.on("error", () => {});
    await new Promise((resolver) => socket.once("connect", resolver));
    socket.write("POST /v1/trips HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{");
    await new Promise((resolver) => setTimeout(resolver, 100));
    const inicio = Date.now();
    await servidor.detener();
    expect(Date.now() - inicio).toBeLessThan(3000); // sin el plazo esperaría hasta el tiempo máximo de Node (300 s)
    await cerrada; // la conexión colgada fue cortada
    expect(existsSync(join(e.datos, `${NOMBRE_DE_LA_BASE}-wal`))).toBe(false); // y la base se cerró bien
  });

  it("sin versión mínima lo dice en el registro y no exige ninguna", async () => {
    const e = entorno();
    const { registro, url } = await levantar(e);
    expect(registro.entradas.find((x) => x.evento === "servidor_iniciado")?.campos.version_minima).toBe("ninguna");
    expect((await post(`${url}/v1/trips`, VIAJE, { "x-app-version": "0.0.1" })).status).toBe(201);
  });

  it("aplica la versión mínima configurada", async () => {
    const e = entorno();
    const { url } = await levantar(e, { versionMinima: "0.2.0" });
    expect((await post(`${url}/v1/trips`, VIAJE, { "x-app-version": "0.1.0" })).status).toBe(426);
    expect((await post(`${url}/v1/trips`, VIAJE, { "x-app-version": "0.2.0" })).status).toBe(201);
  });

  it("los datos sobreviven a un reinicio: el token de antes sigue sirviendo", async () => {
    const e = entorno();
    const primero = await levantar(e);
    const alta = (await (await post(`${primero.url}/v1/trips`, VIAJE)).json()) as { trip_id: string; token: string };
    await primero.servidor.detener();
    const segundo = await levantar(e);
    const r = await post(`${segundo.url}/v1/trips/${alta.trip_id}/invitations`, {}, { authorization: `Bearer ${alta.token}` });
    expect(r.status).toBe(201);
  });

  it("el pepper sale del archivo: con otro pepper un código de invitación de antes ya no sirve", async () => {
    const e = entorno(PEPPER_A);
    const primero = await levantar(e);
    const alta = (await (await post(`${primero.url}/v1/trips`, VIAJE)).json()) as { trip_id: string; token: string };
    const { codigo } = (await (await post(`${primero.url}/v1/trips/${alta.trip_id}/invitations`, {}, { authorization: `Bearer ${alta.token}` })).json()) as { codigo: string };
    await primero.servidor.detener();
    writeFileSync(e.archivoPepper, PEPPER_B);
    const segundo = await levantar(e);
    const r = await post(`${segundo.url}/v1/join`, { codigo, ...NUEVO });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { codigo: string } }).error.codigo).toBe("codigo_invalido");
  });

  it("sin la opción de registro arma el suyo (pino) con el nivel configurado y escribe en el destino que se le da", async () => {
    const lineas: string[] = [];
    const destino = { write: (l: string) => void lineas.push(l) };
    const e = entorno();
    const servidor = await arrancar(configuracion(e, { nivelDeLog: "info" }), { destino });
    servidores.push(servidor);
    expect((await fetch(`http://127.0.0.1:${servidor.puerto}/healthz`)).status).toBe(200);
    const inicio = JSON.parse(lineas.find((l) => l.includes("servidor_iniciado")) ?? "{}") as Record<string, unknown>;
    expect(inicio).toMatchObject({ evento: "servidor_iniciado", nivel: "info", puerto: servidor.puerto });

    const otro = entorno();
    const callado: string[] = [];
    const sirviendo = await arrancar(configuracion(otro, { nivelDeLog: "warn" }), { destino: { write: (l: string) => void callado.push(l) } });
    servidores.push(sirviendo);
    await fetch(`http://127.0.0.1:${sirviendo.puerto}/healthz`);
    expect(callado).toEqual([]); // el arranque y los pedidos son info: con warn no se escribe nada
  });
});

describe("lo que impide arrancar sale con un mensaje claro y sin dejar nada abierto", () => {
  const falla = async (e: ReturnType<typeof entorno>, extra: Partial<Configuracion> = {}) => {
    try {
      await arrancar(configuracion(e, extra), { registro: new RegistroDeMemoria() });
    } catch (error) {
      return error as Error;
    }
    throw new Error("debía fallar");
  };

  it("una carpeta de datos que no existe o que es un archivo", async () => {
    const e = entorno(PEPPER_A, false);
    const noExiste = await falla(e);
    expect(noExiste).toBeInstanceOf(ErrorDeConfiguracion);
    expect(noExiste.message).toBe(`DATA_DIR no es una carpeta que exista (${e.datos})`);
    writeFileSync(join(e.dir, "marca"), "");
    const archivo = await falla(e, { dirDatos: join(e.dir, "marca") });
    expect(archivo.message).toContain("DATA_DIR no es una carpeta que exista");
  });

  it("una carpeta de adjuntos que no existe o que es un archivo", async () => {
    const e = entorno();
    const noExiste = await falla(e, { dirAdjuntos: join(e.dir, "no-existe") });
    expect(noExiste).toBeInstanceOf(ErrorDeConfiguracion);
    expect(noExiste.message).toBe(`ADJUNTOS_DIR no es una carpeta que exista (${join(e.dir, "no-existe")})`);
    writeFileSync(join(e.dir, "marca"), "");
    expect((await falla(e, { dirAdjuntos: join(e.dir, "marca") })).message).toContain("ADJUNTOS_DIR no es una carpeta que exista");
  });

  it.skipIf(process.getuid?.() === 0)("una carpeta de adjuntos que no se puede escribir falla con un mensaje claro", async () => {
    const e = entorno();
    chmodSync(e.adjuntos, 0o500);
    try {
      const error = await falla(e);
      expect(error).toBeInstanceOf(ErrorDeConfiguracion);
      expect(error.message).toBe(`ADJUNTOS_DIR no se puede escribir (${e.adjuntos})`);
    } finally {
      chmodSync(e.adjuntos, 0o700);
    }
  });

  it.skipIf(process.getuid?.() === 0)("una carpeta de datos que no se puede escribir falla con un mensaje claro", async () => {
    const e = entorno();
    chmodSync(e.datos, 0o500);
    try {
      const error = await falla(e);
      expect(error).toBeInstanceOf(ErrorDeConfiguracion);
      expect(error.message).toBe(`DATA_DIR no se puede escribir (${e.datos})`);
    } finally {
      chmodSync(e.datos, 0o700);
    }
  });

  it("un archivo de pepper que no existe, y uno demasiado corto (31 bytes no, 32 sí, con saltos de línea alrededor)", async () => {
    const e = entorno();
    const sin = await falla(e, { archivoPepper: join(e.dir, "no-existe.txt") });
    expect(sin).toBeInstanceOf(ErrorDeConfiguracion);
    expect(sin.message).toMatch(/^no se puede leer el archivo del pepper \(.*no-existe\.txt\): ENOENT$/);
    writeFileSync(e.archivoPepper, "x".repeat(31));
    const corto = await falla(e);
    expect(corto).toBeInstanceOf(ErrorDeConfiguracion);
    expect(corto.message).toContain("el archivo del pepper no sirve");
    expect(corto.message).toContain("al menos 32 bytes");
    writeFileSync(e.archivoPepper, `\n  ${"x".repeat(32)}\n`);
    servidores.push(await arrancar(configuracion(e), { registro: new RegistroDeMemoria() }));
  });

  it("el mensaje de un pepper malo nunca incluye su contenido", async () => {
    const e = entorno("secreto-corto-ABC");
    const error = await falla(e);
    expect(error.message).not.toContain("secreto-corto-ABC");
  });

  it("un puerto ocupado: falla con EADDRINUSE y el primer servidor sigue sirviendo", async () => {
    const e = entorno();
    const primero = await levantar(e);
    const otro = entorno();
    const espia = vi.spyOn(globalThis, "clearInterval");
    let error: NodeJS.ErrnoException;
    try {
      error = (await falla(otro, { puerto: primero.servidor.puerto })) as NodeJS.ErrnoException;
      expect(espia).toHaveBeenCalledTimes(2); // canceló los dos temporizadores que había creado
    } finally {
      espia.mockRestore();
    }
    expect(error.code).toBe("EADDRINUSE");
    expect((await fetch(`${primero.url}/healthz`)).status).toBe(200);
    // el que no pudo arrancar canceló sus temporizadores y cerró su base
    expect(existsSync(join(otro.datos, `${NOMBRE_DE_LA_BASE}-wal`))).toBe(false);
    // la base del que no pudo arrancar quedó cerrada: se puede volver a arrancar sobre la misma carpeta
    servidores.push(await arrancar(configuracion(otro), { registro: new RegistroDeMemoria() }));
  });
});

describe("iniciarMantenimiento", () => {
  it("programa cada 10 minutos y devuelve cómo detenerlo", () => {
    expect(CADA_DIEZ_MINUTOS_MS).toBe(600_000);
    let cadaMs = 0;
    const cancelados: unknown[] = [];
    const t = {};
    const detener = iniciarMantenimiento({ servicio: { mantenimiento: () => 0 }, registro: new RegistroDeMemoria(), periodo: { programar: (_a, ms) => ((cadaMs = ms), t), cancelar: (x) => cancelados.push(x) } });
    expect(cadaMs).toBe(600_000);
    detener();
    expect(cancelados).toEqual([t]);
  });

  it("borra de verdad los intentos viejos y lo registra: info si borró algo, debug si no", async () => {
    const e = entornoApi();
    let accion: (() => void) | undefined;
    const registro = new RegistroDeMemoria();
    iniciarMantenimiento({ servicio: e.servicio, registro, periodo: { programar: (a) => ((accion = a), {}) } });
    for (let i = 0; i < 3; i++) await e.unirse("ABCDEFGH");
    accion!();
    expect(registro.entradas.at(-1)).toMatchObject({ nivel: "debug", evento: "mantenimiento", campos: { intentos_borrados: 0 } }); // todavía están en la ventana
    e.reloj.ahora += 16 * 60 * 1000;
    accion!();
    expect(registro.entradas.at(-1)).toMatchObject({ nivel: "info", evento: "mantenimiento", campos: { intentos_borrados: 3 } });
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM join_attempt").get()).toEqual({ n: 0 });
  });

  it("un fallo del mantenimiento no tumba el proceso: se registra como error con el error limpio", () => {
    let accion: (() => void) | undefined;
    const registro = new RegistroDeMemoria();
    iniciarMantenimiento({
      servicio: { mantenimiento: () => { throw new Error("falló token=SECRETO-XYZ"); } },
      registro,
      periodo: { programar: (a) => ((accion = a), {}) },
    });
    expect(() => accion!()).not.toThrow();
    const entrada = registro.entradas.find((x) => x.evento === "mantenimiento_fallo");
    expect(entrada?.nivel).toBe("error");
    expect((entrada?.campos.err as { message: string }).message).toBe("falló token=[oculto]");
    expect(JSON.stringify(registro.entradas)).not.toContain("SECRETO-XYZ");
  });
});
