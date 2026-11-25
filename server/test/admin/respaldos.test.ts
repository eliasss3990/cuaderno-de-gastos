import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { CONSERVAR, COPIA_RECIENTE_MS, copiarAntesDeMigrar, hacerRespaldo, nombreDeRespaldo, respaldosDe } from "../../src/admin/respaldos.js";
import { abrirBase } from "../../src/almacen/base/base.js";
import { servicioDeIdentidadSobre } from "../../src/almacen/identidad/servicioSqlite.js";

const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const AHORA = Date.UTC(2027, 1, 14, 3, 0, 5);
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

function entorno() {
  const dir = mkdtempSync(join(tmpdir(), "respaldos-"));
  carpetas.push(dir);
  const db = abrirBase(":memory:");
  servicioDeIdentidadSobre(db, { ahora: () => AHORA, pepper: PEPPER }).crearViaje({
    nombre: "Brasil 2027",
    zonaHoraria: "America/Asuncion",
    monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }],
    nombreDispositivo: "Celu",
    apodo: "Papá",
    color: "#E8E4F3",
    emoji: "🧔",
  });
  return { dir, db };
}

describe("respaldos", () => {
  it("el nombre es AAAA-MM-DDTHHMMSS-motivo.sqlite en UTC", () => {
    expect(nombreDeRespaldo(AHORA, "diario")).toBe("2027-02-14T030005-diario.sqlite");
    expect(CONSERVAR).toEqual({ diario: 7, semanal: 4, predeploy: 2, premigracion: 1, prerestauracion: 1 });
  });

  it("hace una copia consistente y verificada de la base, con los mismos datos", () => {
    const e = entorno();
    const r = hacerRespaldo(e.db, e.dir, "diario", AHORA);
    expect(r).toEqual({ archivo: join(e.dir, "2027-02-14T030005-diario.sqlite"), problemas: [], borrados: [] });
    const copia = new Database(r.archivo, { readonly: true });
    expect(copia.prepare("SELECT COUNT(*) AS n FROM op").get()).toEqual(e.db.prepare("SELECT COUNT(*) AS n FROM op").get());
    copia.close();
  });

  it("rota solo los de su motivo: conserva los N más nuevos y no toca otros archivos", () => {
    const e = entorno();
    for (let d = 1; d <= 8; d++) writeFileSync(join(e.dir, `2027-01-${String(d).padStart(2, "0")}T030000-diario.sqlite`), "");
    for (let d = 1; d <= 6; d++) writeFileSync(join(e.dir, `2027-01-${String(d).padStart(2, "0")}T030000-predeploy.sqlite`), "");
    writeFileSync(join(e.dir, "notas.txt"), "");
    writeFileSync(join(e.dir, "2027-01-01T030000-diario.sqlite.bak"), "");
    const r = hacerRespaldo(e.db, e.dir, "diario", AHORA);
    // 8 viejos + el nuevo = 9: se van los 2 más viejos
    expect(r.borrados).toEqual(["2027-01-02T030000-diario.sqlite", "2027-01-01T030000-diario.sqlite"]);
    expect(respaldosDe(e.dir, "diario")).toHaveLength(7);
    expect(respaldosDe(e.dir, "diario")[0]).toBe("2027-02-14T030005-diario.sqlite");
    expect(respaldosDe(e.dir, "predeploy")).toHaveLength(6);
    expect(existsSync(join(e.dir, "notas.txt")) && existsSync(join(e.dir, "2027-01-01T030000-diario.sqlite.bak"))).toBe(true);
  });

  it("si la copia no verifica, la conserva, lo informa y no rota (uno roto no empuja afuera a uno bueno)", () => {
    const e = entorno();
    for (let d = 1; d <= 7; d++) writeFileSync(join(e.dir, `2027-01-${String(d).padStart(2, "0")}T030000-diario.sqlite`), "");
    e.db.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('x', 'expense', 'inventado')").run();
    const r = hacerRespaldo(e.db, e.dir, "diario", AHORA);
    expect(r.problemas).toEqual(["viaje x: entidad sin operaciones que la expliquen: expense/inventado"]);
    expect(r.borrados).toEqual([]);
    expect(r.archivo).toBe(join(e.dir, "2027-02-14T030005-diario.sqlite.roto"));
    expect(existsSync(r.archivo)).toBe(true);
    // la rota queda con otro nombre: no cuenta entre los que se conservan
    expect(respaldosDe(e.dir, "diario")).toHaveLength(7);
    // otra rota del mismo motivo reemplaza a la anterior (no se acumulan); las de otro motivo no se tocan
    writeFileSync(join(e.dir, "2027-01-01T030000-predeploy.sqlite.roto"), "");
    const otra = hacerRespaldo(e.db, e.dir, "diario", AHORA + 1000);
    expect(otra.archivo).toBe(join(e.dir, "2027-02-14T030006-diario.sqlite.roto"));
    expect(readdirSync(e.dir).filter((n) => n.endsWith(".roto")).sort((a, b) => a.localeCompare(b, "en"))).toEqual([
      "2027-01-01T030000-predeploy.sqlite.roto",
      "2027-02-14T030006-diario.sqlite.roto",
    ]);
  });

  it("no pisa un respaldo del mismo segundo, ni acepta un motivo desconocido o una carpeta que no existe", () => {
    const e = entorno();
    hacerRespaldo(e.db, e.dir, "diario", AHORA);
    expect(() => hacerRespaldo(e.db, e.dir, "diario", AHORA + 999)).toThrow(/ya existe un respaldo con ese nombre/);
    expect(() => hacerRespaldo(e.db, e.dir, "toString", AHORA)).toThrow(/motivo desconocido: toString/);
    expect(() => hacerRespaldo(e.db, join(e.dir, "no-existe"), "diario", AHORA)).toThrow(/no existe la carpeta de respaldos/);
  });

  it("una copia previa a migrar de menos de una hora no se reemplaza (un reinicio en bucle la pisaría con una base a medio migrar)", () => {
    const e = entorno();
    const primera = copiarAntesDeMigrar(e.db, e.dir, AHORA);
    e.db.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES ('x', 'expense', 'despues')").run();
    expect(copiarAntesDeMigrar(e.db, e.dir, AHORA + COPIA_RECIENTE_MS - 1000)).toBe(primera);
    expect(respaldosDe(e.dir, "premigracion")).toEqual(["2027-02-14T030005-premigracion.sqlite"]);
    const nueva = copiarAntesDeMigrar(e.db, e.dir, AHORA + COPIA_RECIENTE_MS);
    expect(nueva).not.toBe(primera);
    expect(respaldosDe(e.dir, "premigracion")).toEqual(["2027-02-14T040005-premigracion.sqlite"]);
    expect(COPIA_RECIENTE_MS).toBe(60 * 60 * 1000);
  });

  it("la copia previa a una migración no se verifica (está en la versión vieja) y rota con su propio tope", () => {
    const e = entorno();
    mkdirSync(join(e.dir, "sub"));
    for (let d = 1; d <= 2; d++) writeFileSync(join(e.dir, "sub", `2027-01-${String(d).padStart(2, "0")}T030000-premigracion.sqlite`), "");
    const archivo = copiarAntesDeMigrar(e.db, join(e.dir, "sub"), AHORA);
    expect(archivo).toBe(join(e.dir, "sub", "2027-02-14T030005-premigracion.sqlite"));
    expect(readdirSync(join(e.dir, "sub"))).toEqual(["2027-02-14T030005-premigracion.sqlite"]);
  });
});
