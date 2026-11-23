import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONSULTAS } from "../../src/almacen/almacenSqlite.js";
import { abrirBase } from "../../src/almacen/base.js";
import { migrar, VERSION_ACTUAL, type Migracion } from "../../src/almacen/migraciones.js";

const tablas = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);

describe("migraciones", () => {
  it("una base nueva recibe todas las migraciones y queda registrada la versión", () => {
    const db = new Database(":memory:");
    expect(migrar(db, 1234)).toEqual([1]);
    expect(tablas(db)).toEqual(["entity", "entity_field", "entity_tombstone", "op", "schema_migration", "trip_closed_interval"]);
    expect(db.prepare("SELECT version, aplicada_en FROM schema_migration").all()).toEqual([{ version: VERSION_ACTUAL, aplicada_en: 1234 }]);
  });

  it("una migración que falla a medias no deja nada y no registra la versión; las anteriores se conservan", () => {
    const db = new Database(":memory:");
    const m1: Migracion = { version: 1, sql: "CREATE TABLE a (x INTEGER);" };
    const m2: Migracion = { version: 2, sql: "CREATE TABLE b (x INTEGER); CREATE TABLE a (x INTEGER);" }; // la segunda sentencia falla
    expect(() => migrar(db, 1, [m1, m2])).toThrow(/already exists/);
    expect(tablas(db)).toEqual(["a", "schema_migration"]);
    expect(db.prepare("SELECT version FROM schema_migration").all()).toEqual([{ version: 1 }]);
    const m2bien: Migracion = { version: 2, sql: "CREATE TABLE b (x INTEGER);" };
    expect(migrar(db, 2, [m1, m2bien])).toEqual([2]);
    expect(tablas(db)).toEqual(["a", "b", "schema_migration"]);
  });

  it("una base con un esquema más nuevo que el código se rechaza con un error claro y no se toca", () => {
    const db = new Database(":memory:");
    migrar(db);
    db.prepare("INSERT INTO schema_migration (version, aplicada_en) VALUES (99, 1)").run();
    expect(() => migrar(db)).toThrow(/versión 99.*hasta la 1/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()).toEqual({ n: 2 });
  });

  it("volver a migrar no hace nada", () => {
    const db = new Database(":memory:");
    migrar(db);
    expect(migrar(db)).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()).toEqual({ n: 1 });
  });

  it("abrirBase deja WAL (en archivo), claves foráneas y la espera configurada", () => {
    const db = abrirBase(":memory:", { esperaMs: 1234 });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(1234);
    expect(abrirBase(":memory:").pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("synchronous", { simple: true })).toBe(2); // FULL
  });

  it("si la migración falla, abrirBase cierra la base que abrió", () => {
    const cierres = vi.spyOn(Database.prototype, "close");
    try {
      const ruta = join(mkdtempSync(join(tmpdir(), "cuaderno-")), "rota.db");
      const previa = new Database(ruta);
      previa.exec("CREATE TABLE schema_migration (otra TEXT)");
      previa.close();
      cierres.mockClear();
      expect(() => abrirBase(ruta)).toThrow();
      expect(cierres).toHaveBeenCalledTimes(1);
    } finally {
      cierres.mockRestore();
    }
  });

  it("la búsqueda de adjuntos de un dueño usa su índice y las de operaciones por entidad y por padre también", () => {
    const db = abrirBase(":memory:");
    const plan = (sql: string, ...args: string[]) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((f) => f.detail).join(" | ");
    expect(plan(CONSULTAS.adjuntosDe, "v", "x")).toContain("ix_field_dueno");
    expect(plan(CONSULTAS.padreRegistrado, "v", "t", "i")).toContain("ix_op_entidad (trip_id=? AND entity_type=? AND entity_id=?)");
    expect(plan(CONSULTAS.redactarPorEntidad, "v", "t", "i")).toContain("ix_op_entidad (trip_id=? AND entity_type=? AND entity_id=?)");
    expect(plan(CONSULTAS.redactarPorPadre, "v", "p")).toContain("ix_op_padre");
    expect(plan(CONSULTAS.marcaEnUso, "v", "h")).toContain("ux_op_hlc");
    // y ninguna recorre toda la tabla de operaciones
    const consultas: [string, string[]][] = [
      [CONSULTAS.padreRegistrado, ["v", "t", "i"]],
      [CONSULTAS.redactarPorEntidad, ["v", "t", "i"]],
      [CONSULTAS.redactarPorPadre, ["v", "p"]],
      [CONSULTAS.marcaEnUso, ["v", "h"]],
    ];
    for (const [sql, args] of consultas) expect(plan(sql, ...args)).not.toMatch(/SCAN op/);
  });

  describe("restricciones del esquema", () => {
    const db = abrirBase(":memory:");
    const op = (extra: { [c: string]: unknown } = {}) => ({ t: "v", s: 1, id: "o1", hlc: "h1", p: "{}", r: 0, ...extra });
    const insertar = (o: ReturnType<typeof op>) =>
      db.prepare("INSERT INTO op (trip_id, server_seq, op_id, entity_type, entity_id, padre_id, type, hlc, payload, redactada) VALUES (@t, @s, @id, 'expense', 'e1', NULL, 'expense.create', @hlc, @p, @r)").run(o);

    it("op: el op_id y la marca son únicos, y redactada exige payload nulo (y al revés)", () => {
      insertar(op());
      expect(() => insertar(op({ s: 2, hlc: "h2" }))).toThrow(/UNIQUE/); // mismo op_id
      expect(() => insertar(op({ s: 2, id: "o2" }))).toThrow(/UNIQUE/); // misma marca
      expect(() => insertar(op({ s: 2, id: "o2", hlc: "h2", r: 1 }))).toThrow(/CHECK/); // redactada con payload
      expect(() => insertar(op({ s: 2, id: "o2", hlc: "h2", p: null }))).toThrow(/CHECK/); // payload nulo sin redactar
      insertar(op({ s: 2, id: "o2", hlc: "h2", p: null, r: 1 }));
      expect(() => insertar(op({ s: 1, id: "o3", hlc: "h3" }))).toThrow(/UNIQUE/); // misma secuencia
    });

    it("op: las marcas y los op_id de dos viajes pueden coincidir", () => {
      insertar(op({ t: "otro", s: 1, id: "x1", hlc: "h1" }));
      insertar(op({ t: "otro", s: 2, id: "o1", hlc: "h9" }));
    });

    it("intervalos: el fin debe ser posterior al inicio, la causa válida y el inicio único", () => {
      const ins = (d: number, h: number | null, c: string) => db.prepare("INSERT INTO trip_closed_interval VALUES ('v', ?, ?, ?)").run(d, h, c);
      expect(() => ins(10, 10, "MANUAL")).toThrow(/CHECK/);
      expect(() => ins(10, 5, "MANUAL")).toThrow(/CHECK/);
      expect(() => ins(10, null, "OTRA")).toThrow(/CHECK/);
      ins(10, 20, "MANUAL");
      expect(() => ins(10, null, "FECHAS")).toThrow(/UNIQUE/);
      ins(30, null, "FECHAS");
      expect(() => ins(40, null, "MANUAL")).toThrow(/UNIQUE/); // dos abiertos del mismo viaje
      db.prepare("INSERT INTO trip_closed_interval VALUES ('otro', 10, NULL, 'MANUAL')").run(); // otro viaje, sí
    });

    it("campos: sin entidad no hay campo y al borrar la entidad caen sus campos", () => {
      const campo = () => db.prepare("INSERT INTO entity_field VALUES ('v', 'expense', 'e9', 'nota', '\"x\"', 'h')").run();
      expect(campo).toThrow(/FOREIGN KEY/);
      db.prepare("INSERT INTO entity VALUES ('v', 'expense', 'e9')").run();
      campo();
      db.prepare("DELETE FROM entity WHERE id = 'e9'").run();
      expect(db.prepare("SELECT COUNT(*) AS n FROM entity_field WHERE id = 'e9'").get()).toEqual({ n: 0 });
    });
  });
});
