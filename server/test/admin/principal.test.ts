import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { principal, SALIDA_ERROR, SALIDA_FALLO, SALIDA_OK, SALIDA_USO } from "../../src/admin/principal.js";
import { abrirBase } from "../../src/almacen/base/base.js";
import { comprobarElPepper } from "../../src/almacen/base/pepper.js";
import { leerPepper } from "../../src/dominio/identidad/credenciales.js";

const PEPPER_A = "a".repeat(64);
const PEPPER_B = "b".repeat(64);
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

function entorno() {
  const dir = mkdtempSync(join(tmpdir(), "admin-"));
  carpetas.push(dir);
  mkdirSync(join(dir, "datos"));
  mkdirSync(join(dir, "adjuntos"));
  const archivoPepper = join(dir, "pepper.txt");
  writeFileSync(archivoPepper, PEPPER_A);
  const env = { DATA_DIR: join(dir, "datos"), ADJUNTOS_DIR: join(dir, "adjuntos"), PEPPER_FILE: archivoPepper };
  /** Lo que hace el servidor al arrancar: crea la base, la migra y registra el pepper. */
  const comoElServidor = (pepper = PEPPER_A) => {
    const db = abrirBase(join(dir, "datos", "cuaderno.db"));
    comprobarElPepper(db, leerPepper(pepper), false);
    db.close();
  };
  const correr = async (...argv: string[]) => {
    const salida: string[] = [];
    const error: string[] = [];
    const codigo = await principal(argv, env, { salida: (l) => salida.push(l), error: (l) => error.push(l) }, () => 1802000000000);
    return { codigo, salida, error };
  };
  return { dir, env, archivoPepper, correr, comoElServidor };
}

describe("principal", () => {
  it("un comando que sale bien escribe en la salida y devuelve 0", async () => {
    const e = entorno();
    e.comoElServidor();
    expect(await e.correr("viajes")).toEqual({ codigo: SALIDA_OK, salida: ["no hay viajes"], error: [] });
  });

  it("un error de uso devuelve 64 con el motivo y la ayuda, aunque falte la configuración", async () => {
    const errores: string[] = [];
    expect(await principal(["borrar-todo"], {}, { salida: () => undefined, error: (l) => errores.push(l) })).toBe(SALIDA_USO);
    expect(errores[0]).toBe("comando desconocido: borrar-todo");
    expect(errores[1]).toMatch(/^uso: node dist\/admin.js/);
    expect(errores.join("\n")).toContain("revocar --dispositivo");
  });

  it("un error del servicio devuelve 1 con su mensaje y nada en la salida", async () => {
    const e = entorno();
    e.comoElServidor();
    expect(await e.correr("invitar", "--viaje", "no-existe")).toEqual({ codigo: SALIDA_ERROR, salida: [], error: ["el viaje no existe"] });
  });

  it("sin configuración devuelve 1 y dice qué falta", async () => {
    const errores: string[] = [];
    expect(await principal(["viajes"], {}, { salida: () => undefined, error: (l) => errores.push(l) })).toBe(SALIDA_ERROR);
    expect(errores.join(" ")).toContain("falta DATA_DIR");
  });

  it("con un pepper distinto del de la base no hace nada, devuelve 1 y no muestra el pepper; nunca lo acepta", async () => {
    const e = entorno();
    e.comoElServidor();
    expect((await e.correr("viajes")).codigo).toBe(SALIDA_OK);
    writeFileSync(e.archivoPepper, PEPPER_B);
    const errores: string[] = [];
    expect(await principal(["viajes"], { ...e.env, ACEPTAR_PEPPER_NUEVO: "1" }, { salida: () => undefined, error: (l) => errores.push(l) })).toBe(SALIDA_ERROR);
    expect(errores).toEqual(["el pepper no coincide con el que usó esta base"]);
    writeFileSync(e.archivoPepper, PEPPER_A);
    expect((await e.correr("viajes")).codigo).toBe(SALIDA_OK);
  });

  it("ayuda o --help muestran la ayuda en la salida y salen bien, sin necesitar configuración", async () => {
    for (const pedido of ["ayuda", "--help"]) {
      const salida: string[] = [];
      expect(await principal([pedido], {}, { salida: (l) => salida.push(l), error: () => undefined })).toBe(SALIDA_OK);
      expect(salida[0]).toMatch(/^uso: node dist\/admin.js/);
    }
  });

  it("ayuda con algo más no es un pedido de ayuda: es un error de uso", async () => {
    const errores: string[] = [];
    expect(await principal(["ayuda", "viajes"], {}, { salida: () => undefined, error: (l) => errores.push(l) })).toBe(SALIDA_USO);
    expect(errores[0]).toBe("comando desconocido: ayuda");
  });

  it("sin base en DATA_DIR no crea ninguna: devuelve 1 y lo explica", async () => {
    const e = entorno();
    const r = await e.correr("viajes");
    expect(r.codigo).toBe(SALIDA_ERROR);
    expect(r.error.join(" ")).toContain("no hay una base en");
    expect(existsSync(join(e.dir, "datos", "cuaderno.db"))).toBe(false);
  });

  it("con una base sin huella del pepper no la registra: devuelve 1 y pide arrancar el servidor", async () => {
    const e = entorno();
    abrirBase(join(e.dir, "datos", "cuaderno.db")).close(); // migrada, pero sin huella
    const r = await e.correr("viajes");
    expect(r.codigo).toBe(SALIDA_ERROR);
    expect(r.error).toEqual(["la base todavía no tiene la huella del pepper: arrancá el servidor una vez antes de administrarla"]);
    const db = abrirBase(join(e.dir, "datos", "cuaderno.db"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM servidor_parametro").get()).toEqual({ n: 0 });
    db.close();
  });

  it("no migra: con una base en otra versión de esquema se niega y no la toca", async () => {
    const e = entorno();
    e.comoElServidor();
    const db = abrirBase(join(e.dir, "datos", "cuaderno.db"));
    db.prepare("DELETE FROM schema_migration WHERE version = (SELECT MAX(version) FROM schema_migration)").run();
    const antes = (db.prepare("SELECT MAX(version) AS v FROM schema_migration").get() as { v: number }).v;
    db.close();
    const r = await e.correr("viajes");
    expect(r.codigo).toBe(SALIDA_ERROR);
    expect(r.error.join(" ")).toContain(`la base está en la versión ${antes} de esquema`);
    const despues = new Database(join(e.dir, "datos", "cuaderno.db"));
    expect((despues.prepare("SELECT MAX(version) AS v FROM schema_migration").get() as { v: number }).v).toBe(antes);
    despues.close();
  });

  it("una base más nueva que este código o un archivo que no es una base del servidor: devuelve 1 y no lo toca", async () => {
    const e = entorno();
    e.comoElServidor();
    const ruta = join(e.dir, "datos", "cuaderno.db");
    const db = new Database(ruta);
    db.prepare("INSERT INTO schema_migration (version, aplicada_en) VALUES (999, 1)").run();
    db.close();
    const nueva = await e.correr("viajes");
    expect(nueva.codigo).toBe(SALIDA_ERROR);
    expect(nueva.error.join(" ")).toContain("la base está en la versión 999 de esquema");
    const ajena = entorno();
    const otra = new Database(join(ajena.dir, "datos", "cuaderno.db"));
    otra.exec("CREATE TABLE cualquier (x INTEGER)");
    otra.pragma("journal_mode = DELETE");
    otra.close();
    const r = await ajena.correr("viajes");
    expect(r.codigo).toBe(SALIDA_ERROR);
    expect(r.error.join(" ")).toContain("no se puede administrar esta base: no such table: schema_migration");
    const despues = new Database(join(ajena.dir, "datos", "cuaderno.db"));
    expect(despues.pragma("journal_mode", { simple: true })).toBe("delete"); // no la pasó a WAL
    despues.close();
  });

  // root ignora los permisos: ahí la prueba no puede armar una base ilegible
  it.skipIf(process.getuid?.() === 0)("si la base existe pero no se puede abrir, no dice que no hay base", async () => {
    const e = entorno();
    e.comoElServidor();
    const ruta = join(e.dir, "datos", "cuaderno.db");
    chmodSync(ruta, 0o000); // existe, pero quien administra no la puede leer
    try {
      const r = await e.correr("viajes");
      expect(r.codigo).toBe(SALIDA_ERROR);
      expect(r.error.join(" ")).toContain("no se puede abrir la base en");
    } finally {
      chmodSync(ruta, 0o600);
    }
  });

  it("un fallo inesperado devuelve 2", async () => {
    const e = entorno();
    e.comoElServidor();
    const errores: string[] = [];
    expect(await principal(["viajes"], e.env, { salida: () => { throw new Error("la terminal se cerró"); }, error: (l) => errores.push(l) })).toBe(SALIDA_FALLO);
    expect(errores).toEqual(["falló: la terminal se cerró"]);
  });

  it("un archivo de pepper que no sirve devuelve 1 sin mostrar su contenido", async () => {
    const e = entorno();
    writeFileSync(e.archivoPepper, "corto-secreto");
    const r = await e.correr("viajes");
    expect(r.codigo).toBe(SALIDA_ERROR);
    expect(r.error.join(" ")).toContain("el archivo del pepper no sirve");
    expect(r.error.join(" ")).not.toContain("corto-secreto");
  });
});
