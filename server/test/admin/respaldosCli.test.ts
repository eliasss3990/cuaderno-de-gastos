import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { principal, SALIDA_ERROR, SALIDA_OK, SALIDA_USO } from "../../src/admin/principal.js";
import { abrirBase } from "../../src/almacen/base/base.js";
import { comprobarElPepper } from "../../src/almacen/base/pepper.js";
import { servicioDeIdentidadSobre } from "../../src/almacen/identidad/servicioSqlite.js";
import { leerPepper } from "../../src/dominio/identidad/credenciales.js";

const PEPPER_A = "a".repeat(64);
const PEPPER_B = "b".repeat(64);
const AHORA = Date.UTC(2027, 1, 14, 3, 0, 5);
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});
const apagado: typeof fetch = async () => {
  throw new TypeError("fetch failed");
};

function entorno(pepper = PEPPER_A) {
  const dir = mkdtempSync(join(tmpdir(), "respaldos-cli-"));
  carpetas.push(dir);
  for (const c of ["datos", "adjuntos", "respaldos"]) mkdirSync(join(dir, c));
  writeFileSync(join(dir, "pepper.txt"), pepper);
  const base = join(dir, "datos", "cuaderno.db");
  const env = { DATA_DIR: join(dir, "datos"), ADJUNTOS_DIR: join(dir, "adjuntos"), PEPPER_FILE: join(dir, "pepper.txt"), BACKUP_DIR: join(dir, "respaldos") };
  /** Lo que hace el servidor: crea la base, registra el pepper y, si se pide, un viaje. */
  const comoElServidor = (viajes = 1) => {
    const db = abrirBase(base);
    comprobarElPepper(db, leerPepper(pepper), false);
    const servicio = servicioDeIdentidadSobre(db, { ahora: () => AHORA, pepper: leerPepper(pepper) });
    for (let i = 0; i < viajes; i++) {
      servicio.crearViaje({ nombre: `Viaje ${i}`, zonaHoraria: "America/Asuncion", monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }], nombreDispositivo: "Celu", apodo: "Papá", color: "#E8E4F3", emoji: "🧔" });
    }
    db.close();
  };
  const correr = async (argv: string[], extraEnv: Record<string, string> = {}, pedir: typeof fetch = apagado, ahora = AHORA) => {
    const salida: string[] = [];
    const error: string[] = [];
    const codigo = await principal(argv, { ...env, ...extraEnv }, { salida: (l) => salida.push(l), error: (l) => error.push(l) }, () => ahora, pedir);
    return { codigo, salida, error };
  };
  const viajes = () => {
    const db = new Database(base, { readonly: true });
    const n = (db.prepare("SELECT COUNT(*) AS n FROM entity WHERE tipo = 'trip'").get() as { n: number }).n;
    db.close();
    return n;
  };
  return { dir, base, env, comoElServidor, correr, viajes };
}

describe("backup por la línea de comandos", () => {
  it("copia, verifica y dice dónde quedó; por defecto el motivo es diario", async () => {
    const e = entorno();
    e.comoElServidor();
    expect(await e.correr(["backup"])).toEqual({ codigo: SALIDA_OK, salida: [`respaldo: ${join(e.dir, "respaldos", "2027-02-14T030005-diario.sqlite")}`, "verificar: ok"], error: [] });
    expect((await e.correr(["backup", "--motivo", "predeploy"], {}, apagado, AHORA + 1000)).salida[0]).toMatch(/-predeploy\.sqlite$/);
  });

  it("si la copia no verifica sale con 1 y dice cuál y por qué", async () => {
    const e = entorno();
    e.comoElServidor();
    const db = new Database(e.base);
    db.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('x', 'expense', 'inventado')").run();
    db.close();
    const r = await e.correr(["backup"]);
    expect([r.codigo, r.salida]).toEqual([SALIDA_ERROR, []]);
    expect(r.error).toEqual([`el respaldo ${join(e.dir, "respaldos", "2027-02-14T030005-diario.sqlite.roto")} no verifica:`, "viaje x: entidad sin operaciones que la expliquen: expense/inventado"]);
  });

  it("un motivo desconocido es un error de uso, y sin BACKUP_DIR lo dice", async () => {
    const e = entorno();
    e.comoElServidor();
    const r = await e.correr(["backup", "--motivo", "premigracion"]);
    expect([r.codigo, r.error[0]]).toEqual([SALIDA_USO, "motivo de backup desconocido: premigracion (diario, semanal, predeploy)"]);
    const sin = await e.correr(["backup"], { BACKUP_DIR: "" });
    expect([sin.codigo, sin.error]).toEqual([SALIDA_ERROR, ["falta BACKUP_DIR (la carpeta de los respaldos)"]]);
  });
});

describe("restaurar por la línea de comandos", () => {
  it("con el servidor detenido reemplaza la base, guarda antes la actual y borra el -wal viejo", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    e.comoElServidor(2); // después del respaldo se crearon dos viajes más
    // un -wal real con escrituras de la base anterior sin pasar al archivo (como lo deja un servidor que se cortó)
    const conWal = new Database(e.base);
    conWal.pragma("wal_autocheckpoint = 0");
    conWal.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('del-wal', 'trip', 'del-wal')").run();
    const walViejo = readFileSync(`${e.base}-wal`);
    conWal.close();
    writeFileSync(`${e.base}-wal`, walViejo);
    expect(e.viajes()).toBe(4); // 1 del respaldo, 2 después y 1 que solo está en el -wal
    const r = await e.correr(["restaurar", "--desde", respaldo], {}, apagado, AHORA + 60_000);
    expect(r.error).toEqual([]);
    expect(r.codigo).toBe(SALIDA_OK);
    expect(r.salida).toEqual([`la base anterior quedó en ${join(e.dir, "respaldos", "2027-02-14T030105-prerestauracion.sqlite")}`, `restaurada desde ${respaldo}`]);
    expect(existsSync(`${e.base}-wal`)).toBe(false);
    expect(e.viajes()).toBe(1);
    expect((await e.correr(["verificar"])).codigo).toBe(SALIDA_OK);
    const previa = new Database(join(e.dir, "respaldos", "2027-02-14T030105-prerestauracion.sqlite"), { readonly: true });
    expect((previa.prepare("SELECT COUNT(*) AS n FROM entity WHERE tipo = 'trip'").get() as { n: number }).n).toBe(4);
    previa.close();
  });

  it("restaura sobre una base que una versión más nueva ya migró (la reversa de un despliegue), guardándola igual", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    const nueva = new Database(e.base);
    nueva.prepare("INSERT INTO schema_migration (version, aplicada_en) VALUES (999, 1)").run();
    nueva.close();
    const r = await e.correr(["restaurar", "--desde", respaldo], {}, apagado, AHORA + 60_000);
    expect(r.error).toEqual([]);
    expect(r.salida).toEqual([`la base anterior quedó en ${join(e.dir, "respaldos", "2027-02-14T030105-prerestauracion.sqlite")}`, `restaurada desde ${respaldo}`]);
    expect((await e.correr(["verificar"])).codigo).toBe(SALIDA_OK);
    const guardada = new Database(join(e.dir, "respaldos", "2027-02-14T030105-prerestauracion.sqlite"), { readonly: true });
    expect(guardada.prepare("SELECT MAX(version) AS v FROM schema_migration").get()).toEqual({ v: 999 });
    guardada.close();
  });

  it("si la base actual está dañada y no se puede copiar, avisa y restaura igual", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    writeFileSync(e.base, "esto ya no es una base");
    const r = await e.correr(["restaurar", "--desde", respaldo]);
    expect(r.codigo).toBe(SALIDA_OK);
    expect(r.salida[0]).toMatch(/^aviso: no se pudo copiar la base anterior \(.+\); se restaura igual$/);
    expect(r.salida[1]).toBe(`restaurada desde ${respaldo}`);
    expect(e.viajes()).toBe(1);
  });

  it("la copia previa a restaurar también rota: queda solo la última", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    writeFileSync(join(e.dir, "respaldos", "2027-01-01T030000-prerestauracion.sqlite"), "");
    expect((await e.correr(["restaurar", "--desde", respaldo], {}, apagado, AHORA + 60_000)).codigo).toBe(SALIDA_OK);
    expect(readdirSync(join(e.dir, "respaldos")).filter((n) => n.includes("prerestauracion"))).toEqual(["2027-02-14T030105-prerestauracion.sqlite"]);
  });

  it("reintentar restaurar dentro de la hora no pisa la copia de la base que se reemplazó la primera vez", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    e.comoElServidor(2);
    await e.correr(["restaurar", "--desde", respaldo], {}, apagado, AHORA + 60_000);
    const otra = await e.correr(["restaurar", "--desde", respaldo], {}, apagado, AHORA + 120_000);
    const copia = join(e.dir, "respaldos", "2027-02-14T030105-prerestauracion.sqlite");
    expect(otra.salida[0]).toBe(`la base anterior ya quedó en ${copia} (de hace menos de una hora: no se reemplaza)`);
    const guardada = new Database(copia, { readonly: true });
    expect((guardada.prepare("SELECT COUNT(*) AS n FROM entity WHERE tipo = 'trip'").get() as { n: number }).n).toBe(3);
    guardada.close();
  });

  it("un --desde que no es una base lo dice claro", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const texto = join(e.dir, "texto.sqlite");
    writeFileSync(texto, "no es una base");
    expect((await e.correr(["restaurar", "--desde", texto])).error[0]).toMatch(/^el respaldo (no verifica|no es una base del servidor)/);
    expect((await e.correr(["restaurar", "--desde", join(e.dir, "respaldos")])).error[0]).toMatch(/^el respaldo (no verifica|no es una base del servidor)/);
  });

  it("restaura un respaldo de una versión de esquema anterior (después de una migración); el arranque lo migra", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    // el respaldo vuelve a la versión 3: antes de la tabla de la huella del pepper y del tope de invitaciones
    const viejo = new Database(respaldo);
    viejo.exec("DROP INDEX ix_invitation_pendiente; ALTER TABLE invitation DROP COLUMN por_administrador; DROP TABLE servidor_parametro; DELETE FROM schema_migration WHERE version = 4;");
    viejo.close();
    const r = await e.correr(["restaurar", "--desde", respaldo], {}, apagado, AHORA + 60_000);
    expect(r.error).toEqual([]);
    expect(r.salida.at(-1)).toBe("aviso: el respaldo es de antes de la huella del pepper; si el pepper cambió desde entonces, las invitaciones viejas no sirven");
    const restaurada = new Database(e.base, { readonly: true });
    expect(restaurada.prepare("SELECT MAX(version) AS v FROM schema_migration").get()).toEqual({ v: 3 });
    restaurada.close();
    // lo que hace el servidor al arrancar: migra y registra el pepper; después se administra normalmente
    e.comoElServidor(0);
    expect((await e.correr(["verificar"])).codigo).toBe(SALIDA_OK);
    expect(e.viajes()).toBe(1);
  });

  it("un respaldo de una versión anterior dañado a nivel de SQLite no se restaura", async () => {
    const e = entorno();
    e.comoElServidor(3);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    const viejo = new Database(respaldo);
    viejo.exec("DROP INDEX ix_invitation_pendiente; ALTER TABLE invitation DROP COLUMN por_administrador; DROP TABLE servidor_parametro; DELETE FROM schema_migration WHERE version = 4;");
    const tamano = viejo.pragma("page_size", { simple: true }) as number;
    viejo.close();
    const bytes = readFileSync(respaldo);
    // una marca en una hoja de op o de sus índices (op es WITHOUT ROWID: todo es tipo 0x0a); el dispositivo va
    // después de "-0000-" y está indexado, así que tabla e índices dejan de coincidir
    let donde = -1;
    for (let desde = bytes.indexOf("-0000-"); desde !== -1 && donde === -1; desde = bytes.indexOf("-0000-", desde + 1)) {
      if (bytes[Math.floor(desde / tamano) * tamano] === 0x0a) donde = desde + 6;
    }
    expect(donde).toBeGreaterThan(0);
    bytes[donde] = bytes[donde] === 0x66 ? 0x65 : 0x66; // otro hexadecimal: la fila ya no coincide con su índice
    writeFileSync(respaldo, bytes);
    const r = await e.correr(["restaurar", "--desde", respaldo]);
    expect(r.codigo).toBe(SALIDA_ERROR);
    expect(r.error[0]).toMatch(/^el respaldo no verifica, no se restaura: integridad: /);
    expect(e.viajes()).toBe(3);
  });

  it("un respaldo de una versión más nueva que el código no se restaura", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    const nuevo = new Database(respaldo);
    nuevo.prepare("INSERT INTO schema_migration (version, aplicada_en) VALUES (999, 1)").run();
    nuevo.close();
    expect((await e.correr(["restaurar", "--desde", respaldo])).error[0]).toMatch(/^el respaldo no verifica, no se restaura: el respaldo está en la versión 999 de esquema/);
  });

  it("las copias no dejan temporales: solo archivos con nombre de respaldo", async () => {
    const e = entorno();
    e.comoElServidor(1);
    await e.correr(["backup"]);
    await e.correr(["backup", "--motivo", "predeploy"], {}, apagado, AHORA + 1000);
    expect(readdirSync(join(e.dir, "respaldos")).filter((n) => !/^\d{4}-\d{2}-\d{2}T\d{6}-[a-z]+\.sqlite$/.test(n))).toEqual([]);
  });

  it("sin base viva (máquina nueva) restaura sin copia previa", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    rmSync(e.base);
    const r = await e.correr(["restaurar", "--desde", respaldo]);
    expect([r.codigo, r.salida]).toEqual([SALIDA_OK, [`restaurada desde ${respaldo}`]]);
    expect(e.viajes()).toBe(1);
  });

  it("se niega si el servidor responde, si el respaldo no verifica, si es de otro pepper o si no existe, y no toca la base", async () => {
    const e = entorno();
    e.comoElServidor(1);
    const respaldo = (await e.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    e.comoElServidor(1);
    const corriendo: typeof fetch = async () => Response.json({ estado: "ok" });
    expect((await e.correr(["restaurar", "--desde", respaldo], {}, corriendo)).error).toEqual(["el servidor está corriendo: detenerlo antes de restaurar (docker compose stop cuaderno-server)"]);
    const roto = join(e.dir, "respaldos", "roto.sqlite");
    const db = new Database(respaldo);
    db.prepare("VACUUM INTO ?").run(roto);
    db.close();
    const r2 = new Database(roto);
    r2.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('x', 'expense', 'inventado')").run();
    r2.close();
    expect((await e.correr(["restaurar", "--desde", roto])).error[0]).toMatch(/^el respaldo no verifica, no se restaura: /);
    const otro = entorno(PEPPER_B);
    otro.comoElServidor(1);
    const ajeno = (await otro.correr(["backup"])).salida[0]?.slice("respaldo: ".length) ?? "";
    expect((await e.correr(["restaurar", "--desde", ajeno])).error).toEqual(["el respaldo no tiene la huella del pepper actual: con este pepper el servidor no arrancaría"]);
    expect((await e.correr(["restaurar", "--desde", join(e.dir, "no-existe.sqlite")])).error).toEqual([`no existe el respaldo ${join(e.dir, "no-existe.sqlite")}`]);
    expect((await e.correr(["restaurar"])).codigo).toBe(SALIDA_USO);
    expect((await e.correr(["restaurar", "--desde", respaldo], { BACKUP_DIR: "" })).error).toEqual(["falta BACKUP_DIR (ahí queda una copia de la base actual antes de reemplazarla)"]);
    expect(e.viajes()).toBe(2);
    expect(readdirSync(join(e.dir, "respaldos")).filter((n) => n.includes("prerestauracion"))).toEqual([]);
  });
});
