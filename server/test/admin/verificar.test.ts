import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verificarBase, verificarRespaldo } from "../../src/admin/verificar.js";
import { abrirBase } from "../../src/almacen/base/base.js";
import { AlmacenSqlite } from "../../src/almacen/operaciones/almacenSqlite.js";
import { Ingesta } from "../../src/dominio/operaciones/ingesta.js";
import type { Operacion } from "../../src/dominio/operaciones/operaciones.js";
import { REMITENTE } from "../ayudas/autor.js";

// los de la ingesta: lo que llega a una base real pasó por ella (los del motor solo prueban el motor y no siempre son válidos)
const vectores = JSON.parse(readFileSync(new URL("../../../conformance/ingesta.json", import.meta.url), "utf8")) as {
  escenarios: { nombre: string; ops: Operacion[]; orden: number[] }[];
};
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

/** Una base con cada escenario de los vectores de ingesta en su propio viaje (purga, borrados, adjuntos, monedas, efectivo). */
function baseConLosVectores() {
  const db = abrirBase(":memory:");
  vectores.escenarios.forEach((esc, n) => {
    const ingesta = new Ingesta(new AlmacenSqlite(db, `viaje-${String(n).padStart(3, "0")}`));
    for (const i of esc.orden) ingesta.procesar(esc.ops[i] as Operacion, REMITENTE);
  });
  return db;
}

describe("verificarBase", () => {
  it("una base sana (todos los vectores, con purgas y redacciones) no tiene problemas", () => {
    const db = baseConLosVectores();
    expect((db.prepare("SELECT COUNT(*) AS n FROM op WHERE redactada = 1").get() as { n: number }).n).toBeGreaterThan(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM entity_tombstone").get() as { n: number }).n).toBeGreaterThan(2);
    expect((db.prepare("SELECT COUNT(DISTINCT trip_id) AS n FROM op").get() as { n: number }).n).toBe(vectores.escenarios.length);
    expect(verificarBase(db)).toEqual([]);
  });

  it("un campo alterado a mano aparece, sin mostrar su valor", () => {
    const db = baseConLosVectores();
    const f = db.prepare("SELECT trip_id, tipo, id, campo FROM entity_field WHERE tipo = 'expense' LIMIT 1").get() as { trip_id: string; tipo: string; id: string; campo: string };
    db.prepare("UPDATE entity_field SET valor = '\"ALTERADO-A-MANO\"' WHERE trip_id = ? AND tipo = ? AND id = ? AND campo = ?").run(f.trip_id, f.tipo, f.id, f.campo);
    const problemas = verificarBase(db);
    expect(problemas).toEqual([`viaje ${f.trip_id}: el campo ${f.campo} de ${f.tipo}/${f.id} no coincide con el registro`]);
    expect(problemas.join(" ")).not.toContain("ALTERADO-A-MANO");
  });

  it("un reloj de campo alterado también aparece", () => {
    const db = baseConLosVectores();
    const f = db.prepare("SELECT trip_id, tipo, id, campo FROM entity_field WHERE tipo = 'expense' LIMIT 1").get() as { trip_id: string; tipo: string; id: string; campo: string };
    db.prepare("UPDATE entity_field SET hlc = '0000000000000-0000-otro' WHERE trip_id = ? AND tipo = ? AND id = ? AND campo = ?").run(f.trip_id, f.tipo, f.id, f.campo);
    expect(verificarBase(db)).toEqual([`viaje ${f.trip_id}: el campo ${f.campo} de ${f.tipo}/${f.id} no coincide con el registro`]);
  });

  it("una lápida borrada, una entidad que falta, una entidad de más y una lápida de más aparecen cada una", () => {
    const db = baseConLosVectores();
    const l = db.prepare("SELECT trip_id, tipo, id FROM entity_tombstone LIMIT 1").get() as { trip_id: string; tipo: string; id: string };
    db.prepare("DELETE FROM entity_tombstone WHERE trip_id = ? AND tipo = ? AND id = ?").run(l.trip_id, l.tipo, l.id);
    const e = db.prepare("SELECT trip_id, tipo, id FROM entity WHERE tipo = 'category' LIMIT 1").get() as { trip_id: string; tipo: string; id: string };
    db.prepare("DELETE FROM entity WHERE trip_id = ? AND tipo = ? AND id = ?").run(e.trip_id, e.tipo, e.id);
    db.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('viaje-000', 'expense', 'inventado')").run();
    db.prepare("INSERT INTO entity_tombstone (trip_id, tipo, id) VALUES ('viaje-000', 'shortcut', 'sin-motivo')").run();
    const problemas = verificarBase(db);
    expect(problemas).toContain(`viaje ${l.trip_id}: falta la lápida de ${l.tipo}/${l.id}`);
    expect(problemas).toContain(`viaje ${e.trip_id}: falta la entidad ${e.tipo}/${e.id}`);
    expect(problemas).toContain("viaje viaje-000: entidad sin operaciones que la expliquen: expense/inventado");
    expect(problemas).toContain("viaje viaje-000: lápida sin operación que la explique: shortcut/sin-motivo");
  });

  it("un viaje que solo tiene lápidas (sin operaciones ni entidades) también se revisa", () => {
    const db = baseConLosVectores();
    db.prepare("INSERT INTO entity_tombstone (trip_id, tipo, id) VALUES ('viaje-huerfano', 'expense', 'x')").run();
    expect(verificarBase(db)).toEqual(["viaje viaje-huerfano: lápida sin operación que la explique: expense/x"]);
  });

  it("una operación guardada que ya no es válida aparece (aunque el motor la habría aplicado)", () => {
    const db = baseConLosVectores();
    const o = db.prepare("SELECT trip_id, op_id FROM op WHERE redactada = 0 AND type = 'expense.create' LIMIT 1").get() as { trip_id: string; op_id: string };
    db.prepare("UPDATE op SET payload = '{\"no_es_un_campo\":1}' WHERE trip_id = ? AND op_id = ?").run(o.trip_id, o.op_id);
    expect(verificarBase(db)).toContain(`viaje ${o.trip_id}: la operación ${o.op_id} (expense.create) no es válida (no_es_un_campo)`);
  });

  it("una operación válida que el estado ya no admite aparece con la razón del motor", () => {
    const db = baseConLosVectores();
    // una edición que pasa a apuntar a un gasto que nunca existió
    const o = db.prepare("SELECT trip_id, op_id FROM op WHERE redactada = 0 AND type = 'expense.update' LIMIT 1").get() as { trip_id: string; op_id: string };
    db.prepare("UPDATE op SET entity_id = '018f3a6e-2000-7000-8000-0000000000ff' WHERE trip_id = ? AND op_id = ?").run(o.trip_id, o.op_id);
    expect(verificarBase(db)).toContain(`viaje ${o.trip_id}: la operación ${o.op_id} (expense.update) no se puede reaplicar (entidad_inexistente)`);
  });

  it("con muchos problemas en un viaje detalla 10 y cuenta el resto", () => {
    const db = baseConLosVectores();
    for (let i = 0; i < 15; i++) db.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('viaje-000', 'expense', ?)").run(`inventado-${String(i).padStart(2, "0")}`);
    const problemas = verificarBase(db).filter((p) => p.startsWith("viaje viaje-000:"));
    expect(problemas).toHaveLength(11);
    expect(problemas[10]).toBe("viaje viaje-000: y 5 problemas más");
  });
});

describe("verificarBase con el servidor escribiendo al mismo tiempo", () => {
  it("cada viaje se lee de una sola vez: una escritura entre sus lecturas no da falsos problemas", () => {
    const dir = mkdtempSync(join(tmpdir(), "verificar-vivo-"));
    carpetas.push(dir);
    const ruta = join(dir, "cuaderno.db");
    const db = abrirBase(ruta);
    const ingesta = new Ingesta(new AlmacenSqlite(db, "viaje-000"));
    const esc = vectores.escenarios[0];
    for (const i of esc?.orden ?? []) ingesta.procesar(esc?.ops[i] as Operacion, REMITENTE);
    const otra = abrirBase(ruta); // el servidor, en otra conexión
    const original = AlmacenSqlite.prototype.instantanea;
    let escribio = false;
    const espia = vi.spyOn(AlmacenSqlite.prototype, "instantanea").mockImplementation(function (this: AlmacenSqlite) {
      if (!escribio) {
        escribio = true;
        otra.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('viaje-000', 'expense', 'entra-mientras-se-verifica')").run();
      }
      return original.call(this);
    });
    try {
      expect(verificarBase(db)).toEqual([]);
      expect(escribio).toBe(true);
    } finally {
      espia.mockRestore();
      otra.close();
      db.close();
    }
  });
});

describe("verificarRespaldo", () => {
  const carpeta = () => {
    const dir = mkdtempSync(join(tmpdir(), "verificar-"));
    carpetas.push(dir);
    return dir;
  };

  it("un respaldo sano da ok y no se modifica (se abre en solo lectura)", () => {
    const db = baseConLosVectores();
    const archivo = join(carpeta(), "respaldo.sqlite");
    db.prepare("VACUUM INTO ?").run(archivo);
    const antes = readFileSync(archivo);
    expect(verificarRespaldo(archivo)).toEqual([]);
    expect(readFileSync(archivo).equals(antes)).toBe(true);
  });

  it("un respaldo dañado a nivel de SQLite (un índice que no coincide con su tabla) falla en la integridad", () => {
    const db = baseConLosVectores();
    const archivo = join(carpeta(), "respaldo.sqlite");
    db.prepare("VACUUM INTO ?").run(archivo);
    const copia = new Database(archivo);
    const tamano = copia.pragma("page_size", { simple: true }) as number;
    copia.close();
    const bytes = readFileSync(archivo);
    // la primera aparición de un id de viaje dentro de una hoja de índice (tipo 0x0a): ahí una clave alterada rompe el orden
    let donde = -1;
    for (let desde = bytes.indexOf("viaje-00"); desde !== -1 && donde === -1; desde = bytes.indexOf("viaje-00", desde + 1)) {
      if (bytes[Math.floor(desde / tamano) * tamano] === 0x0a) donde = desde;
    }
    expect(donde).toBeGreaterThan(0);
    bytes[donde] = 0x56; // "V": la clave deja de estar en orden y de coincidir con la fila
    writeFileSync(archivo, bytes);
    const problemas = verificarRespaldo(archivo);
    expect(problemas.length).toBeGreaterThan(0);
    for (const p of problemas) expect(p).toMatch(/^integridad: /);
  });

  it("un respaldo alterado muestra el problema", () => {
    const db = baseConLosVectores();
    db.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('viaje-001', 'expense', 'inventado')").run();
    const archivo = join(carpeta(), "respaldo.sqlite");
    db.prepare("VACUUM INTO ?").run(archivo);
    expect(verificarRespaldo(archivo)).toEqual(["viaje viaje-001: entidad sin operaciones que la expliquen: expense/inventado"]);
  });

  it("un respaldo que no existe, que no es una base del servidor o de otra versión: lo dice", () => {
    const dir = carpeta();
    expect(verificarRespaldo(join(dir, "no-existe.sqlite"))[0]).toMatch(/^no se puede abrir el respaldo/);
    const ajeno = join(dir, "ajeno.sqlite");
    const otra = new Database(ajeno);
    otra.exec("CREATE TABLE x (y INTEGER)");
    otra.close();
    expect(verificarRespaldo(ajeno)[0]).toMatch(/^el respaldo no es una base del servidor: no such table: schema_migration/);
    const texto = join(dir, "texto.sqlite");
    writeFileSync(texto, "esto no es una base");
    expect(verificarRespaldo(texto)[0]).toMatch(/^el respaldo no es una base del servidor/);
    const vieja = join(dir, "vieja.sqlite");
    const db = baseConLosVectores();
    db.prepare("DELETE FROM schema_migration WHERE version = (SELECT MAX(version) FROM schema_migration)").run();
    db.prepare("VACUUM INTO ?").run(vieja);
    expect(verificarRespaldo(vieja)[0]).toMatch(/^el respaldo está en la versión \d+ de esquema y este código espera la \d+$/);
  });
});
