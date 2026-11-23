import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONSULTAS } from "../../../src/almacen/operaciones/almacenSqlite.js";
import { CONSULTAS_IDENTIDAD } from "../../../src/almacen/identidad/identidadSqlite.js";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { MIGRACIONES, migrar, VERSION_ACTUAL, type Migracion } from "../../../src/almacen/base/migraciones.js";

const tablas = (db: Database.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);

describe("migraciones", () => {
  it("una base nueva recibe todas las migraciones y queda registrada la versión", () => {
    const db = new Database(":memory:");
    expect(migrar(db, 1234)).toEqual(MIGRACIONES.map((m) => m.version));
    expect(tablas(db)).toEqual(["device", "entity", "entity_field", "entity_tombstone", "invitation", "join_attempt", "op", "schema_migration", "trip_closed_interval"]);
    expect(db.prepare("SELECT version, aplicada_en FROM schema_migration ORDER BY version").all()).toEqual(MIGRACIONES.map((m) => ({ version: m.version, aplicada_en: 1234 })));
    expect(VERSION_ACTUAL).toBe(MIGRACIONES.length);
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
    expect(() => migrar(db)).toThrow(new RegExp(`versión 99.*hasta la ${VERSION_ACTUAL}`));
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()).toEqual({ n: VERSION_ACTUAL + 1 });
  });

  it("la migración 2 completa una base que ya tenía operaciones de la versión 1", () => {
    const db = new Database(":memory:");
    migrar(db, 1, MIGRACIONES.slice(0, 1));
    const dispositivo = "018f3a6e-0000-7000-8000-00000000000a";
    const hlc = (ms: number) => `${ms.toString(16).padStart(13, "0")}-0000-${dispositivo}`;
    db.prepare("INSERT INTO op (trip_id, server_seq, op_id, entity_type, entity_id, padre_id, type, hlc, payload, redactada) VALUES ('v', 1, 'o1', 'expense', 'e1', NULL, 'expense.create', ?, '{}', 0)").run(hlc(100));
    expect(migrar(db, 2, MIGRACIONES.slice(0, 2))).toEqual([2]);
    expect(db.prepare("SELECT dispositivo FROM op").all()).toEqual([{ dispositivo }]);
  });

  it("volver a migrar no hace nada", () => {
    const db = new Database(":memory:");
    migrar(db);
    expect(migrar(db)).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()).toEqual({ n: VERSION_ACTUAL });
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
    expect(plan(CONSULTAS.ultimaMarcaDe, "v", "d")).toContain("ix_op_dispositivo (trip_id=? AND dispositivo=?)");
    // con la marca como última columna, hallar la mayor de un dispositivo es un salto al final del índice, sin leer filas
    const columnas = (db.pragma("index_info(ix_op_dispositivo)") as { name: string }[]).map((c) => c.name);
    expect(columnas).toEqual(["trip_id", "dispositivo", "hlc"]);
    const identidad: [string, string[]][] = [
      [CONSULTAS_IDENTIDAD.dispositivoPorToken, ["h"]],
      [CONSULTAS_IDENTIDAD.contarActivos, ["v"]],
      [CONSULTAS_IDENTIDAD.dispositivosDelViaje, ["v"]],
      [CONSULTAS_IDENTIDAD.invitacionPorCodigo, ["h"]],
      [CONSULTAS_IDENTIDAD.intentosFallidos, ["ip", "1"]],
      [CONSULTAS_IDENTIDAD.limpiarIntentos, ["1"]],
    ];
    // ninguna consulta de identidad recorre una tabla entera
    for (const [sql, args] of identidad) expect(plan(sql, ...args), sql).not.toMatch(/SCAN (device|invitation|join_attempt)(?! USING)/);
    expect(plan(CONSULTAS_IDENTIDAD.dispositivoPorToken, "h")).toMatch(/sqlite_autoindex_device/);
    expect(plan(CONSULTAS_IDENTIDAD.contarActivos, "v")).toContain("ix_device_trip (trip_id=?");
    expect(plan(CONSULTAS_IDENTIDAD.invitacionPorCodigo, "h")).toMatch(/sqlite_autoindex_invitation/);
    expect(plan(CONSULTAS_IDENTIDAD.intentosFallidos, "ip", "1")).toContain("ix_join_attempt (ip_hash=? AND intentado_en>?)");
    expect(plan(CONSULTAS_IDENTIDAD.limpiarIntentos, "1")).toContain("ix_join_attempt_hora (intentado_en<?)");
    // y ninguna recorre toda la tabla de operaciones
    const consultas: [string, string[]][] = [
      [CONSULTAS.padreRegistrado, ["v", "t", "i"]],
      [CONSULTAS.redactarPorEntidad, ["v", "t", "i"]],
      [CONSULTAS.redactarPorPadre, ["v", "p"]],
      [CONSULTAS.marcaEnUso, ["v", "h"]],
      [CONSULTAS.ultimaMarcaDe, ["v", "d"]],
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

    it("identidad: la base impide una invitación usada a medias y un intento con un ok que no es 0 ni 1", () => {
      const hex = (id: string) => id.charCodeAt(0).toString(16).padStart(64, "0");
      const inv = (id: string, usadaEn: number | null, por: string | null) =>
        db.prepare("INSERT INTO invitation (invitation_id, trip_id, codigo_hash, creada_en, vence_en, usada_en, usada_por_device_id) VALUES (?, 'v', ?, 1, 9, ?, ?)").run(id, hex(id), usadaEn, por);
      inv("a", null, null);
      inv("b", 5, "d1");
      expect(() => inv("c", 5, null)).toThrow(/CHECK/);
      expect(() => inv("d", null, "d1")).toThrow(/CHECK/);
      const intento = (ok: number) => db.prepare("INSERT INTO join_attempt (ip_hash, intentado_en, ok) VALUES (?, 1, ?)").run(hex("i"), ok);
      intento(0);
      intento(1);
      expect(() => intento(2)).toThrow(/CHECK/);
      expect(() => intento(-1)).toThrow(/CHECK/);
    });

    it("identidad: la base impide un seq o unos pendientes negativos aunque alguien escriba directo (el repositorio ya los rechaza antes)", () => {
      const hex = "d".repeat(64);
      db.prepare("INSERT INTO device (device_id, trip_id, member_id, nombre, token_hash, creado_en) VALUES ('dn', 'v', 'mn', 'x', ?, 1)").run(hex);
      expect(() => db.prepare("UPDATE device SET ultimo_seq_visto = -1 WHERE device_id = 'dn'").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE device SET pendientes = -1 WHERE device_id = 'dn'").run()).toThrow(/CHECK/);
      db.prepare("UPDATE device SET ultimo_seq_visto = 0, pendientes = 0 WHERE device_id = 'dn'").run();
    });

    it("identidad: la base impide una revocación anterior a la creación aunque alguien escriba directo", () => {
      const hex = "c".repeat(64);
      db.prepare("INSERT INTO device (device_id, trip_id, member_id, nombre, token_hash, creado_en) VALUES ('dz', 'v', 'mz', 'x', ?, 5000)").run(hex);
      expect(() => db.prepare("UPDATE device SET revocado_en = 4999 WHERE device_id = 'dz'").run()).toThrow(/CHECK/);
      db.prepare("UPDATE device SET revocado_en = 5000 WHERE device_id = 'dz'").run();
    });

    it("identidad: la base impide una invitación usada antes de crearse y un texto en una columna entera, aunque alguien escriba directo", () => {
      const hex = (c: string) => c.repeat(64);
      const ins = (id: string, creada: number | string, usada: number | null, por: string | null) =>
        db.prepare("INSERT INTO invitation (invitation_id, trip_id, codigo_hash, creada_en, vence_en, usada_en, usada_por_device_id) VALUES (?, 'v', ?, ?, 99999, ?, ?)").run(id, hex(id), creada, usada, por);
      ins("e", 100, null, null);
      ins("f", 100, 100, "dispositivo-f");
      expect(() => ins("d", 100, 99, "dispositivo-d")).toThrow(/CHECK/);
      expect(() => ins("a", "abc", null, null)).toThrow(/cannot store TEXT value in INTEGER column|datatype mismatch/);
      expect(() => ins("b", 1.5, null, null)).toThrow(/cannot store REAL value in INTEGER column|datatype mismatch/);
    });

    it("identidad: la base impide que un mismo dispositivo consuma dos invitaciones, aunque alguien escriba directo", () => {
      const ins = (id: string, por: string | null) =>
        db.prepare("INSERT INTO invitation (invitation_id, trip_id, codigo_hash, creada_en, vence_en, usada_en, usada_por_device_id) VALUES (?, 'v', ?, 1, 9, ?, ?)").run(id, id.repeat(64).slice(0, 64), por === null ? null : 5, por);
      ins("1", "dispositivo-x");
      expect(() => ins("2", "dispositivo-x")).toThrow(/UNIQUE/);
      ins("3", "dispositivo-y");
      ins("4", null); // varias sin usar sí pueden convivir
      ins("5", null);
    });

    it("identidad: las tablas son STRICT", () => {
      const estricta = (tabla: string) => (db.prepare("SELECT strict FROM pragma_table_list(?)").get(tabla) as { strict: number }).strict;
      expect([estricta("device"), estricta("invitation"), estricta("join_attempt")]).toEqual([1, 1, 1]);
    });

    it("identidad: el índice de dispositivos por viaje incluye si está revocado, y el de intentos la hora", () => {
      const columnas = (indice: string) => (db.pragma(`index_info(${indice})`) as { name: string }[]).map((c) => c.name);
      expect(columnas("ix_device_trip")).toEqual(["trip_id", "revocado_en"]);
      expect(columnas("ix_join_attempt")).toEqual(["ip_hash", "intentado_en"]);
      expect(columnas("ux_device_miembro_activo")).toEqual(["trip_id", "member_id"]);
      expect(columnas("ix_join_attempt_hora")).toEqual(["intentado_en"]);
      expect(columnas("ux_invitation_dispositivo")).toEqual(["usada_por_device_id"]);
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
