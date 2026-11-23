import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../src/almacen/almacenSqlite.js";
import { abrirBase } from "../../src/almacen/base.js";
import { Ingesta } from "../../src/dominio/ingesta.js";
import type { Operacion } from "../../src/dominio/operaciones.js";

const MARCA = (n: number) => `${n.toString(16).padStart(13, "0")}-0000-018f3a6e-0000-7000-8000-00000000000a`;
const carpetas: string[] = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });
const nueva = (): string => { const c = mkdtempSync(join(tmpdir(), "cuaderno-")); carpetas.push(c); return join(c, "viaje.db"); };

const viaje = (n = 1): Operacion => ({ opId: `o${n}`, tipo: "trip.create", entidadTipo: "trip", entidadId: "018f3a6e-1000-7000-8000-000000000001", hlc: MARCA(100 + n), payload: { nombre: "Brasil", zona_horaria: "America/Asuncion", monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$" }] } });

describe("base SQLite en archivo", () => {
  it("usa modo WAL y conserva lo guardado al cerrar y volver a abrir", () => {
    const ruta = nueva();
    const db = abrirBase(ruta);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(new Ingesta(new AlmacenSqlite(db, "v1")).procesar({ ...viaje(), opId: "018f3a6e-9000-7000-8000-000000000001" })).toEqual({ estado: "accepted", seq: 1 });
    db.close();

    const otra = abrirBase(ruta);
    const almacen = new AlmacenSqlite(otra, "v1");
    expect(almacen.idDelViaje()).toBe("018f3a6e-1000-7000-8000-000000000001");
    expect(almacen.opConocida("018f3a6e-9000-7000-8000-000000000001")).toBe(true);
    expect(almacen.leerCampo("trip", "018f3a6e-1000-7000-8000-000000000001", "nombre")).toBe("Brasil");
    expect(almacen.entidadExiste("trip_currency", "BRL")).toBe(true);
    expect(almacen.entidadExiste("category", "otro")).toBe(true);
    // la secuencia sigue donde estaba, no vuelve a 1
    expect(almacen.secuencias()).toEqual([1]);
    const gasto: Operacion = { opId: "018f3a6e-9000-7000-8000-000000000002", tipo: "expense.create", entidadTipo: "expense", entidadId: "018f3a6e-2000-7000-8000-000000000001", hlc: MARCA(200), payload: { monto_minor: 100, moneda: "BRL", categoria_id: "otro", cuando_ocurrio: 1700000000000, dia_imputado: "2027-02-18" } };
    expect(new Ingesta(almacen).procesar(gasto)).toEqual({ estado: "accepted", seq: 2 });
    otra.close();
  });

  it("migrar al reabrir no repite migraciones", () => {
    const ruta = nueva();
    abrirBase(ruta).close();
    const db = abrirBase(ruta);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migration").get()).toEqual({ n: 1 });
    db.close();
  });

  it("dos viajes en la misma base no se mezclan", () => {
    const db = abrirBase(":memory:");
    const a = new AlmacenSqlite(db, "a");
    const b = new AlmacenSqlite(db, "b");
    a.crearEntidad("trip", "t1");
    a.escribirCampo("trip", "t1", "nombre", "A", MARCA(1));
    a.guardarOp({ opId: "o1", tipo: "trip.create", entidadTipo: "trip", entidadId: "t1", hlc: MARCA(1), payload: {}, redactada: false, padreId: null });
    a.terminar("expense", "e1");
    a.crearEntidad("attachment", "ad1");
    a.escribirCampo("attachment", "ad1", "owner_id", "dueno", MARCA(2));
    expect(b.entidadExiste("attachment", "ad1")).toBe(false);
    expect(b.leerCampo("attachment", "ad1", "owner_id")).toBeUndefined();
    expect(b.leerReloj("attachment", "ad1", "owner_id")).toBeNull();
    expect(b.adjuntosDe("dueno")).toEqual([]);
    expect(a.adjuntosDe("dueno")).toEqual(["ad1"]);
    expect(b.idDelViaje()).toBeNull();
    expect(b.contarEntidades("trip")).toBe(0);
    expect(b.entidadTerminada("expense", "e1")).toBe(false);
    expect(b.marcaEnUso(MARCA(1))).toBe(false);
    expect(b.opConocida("o1")).toBe(false);
    expect(a.opConocida("o1")).toBe(true);
    expect(b.secuencias()).toEqual([]);
    expect(b.guardarOp({ opId: "o2", tipo: "trip.create", entidadTipo: "trip", entidadId: "t2", hlc: MARCA(1), payload: {}, redactada: false, padreId: null })).toBe(1);
    b.abrirIntervalo(5, "MANUAL");
    expect(a.intervalosDeCierre()).toEqual([]);
  });

  it("escribir toma el bloqueo desde el principio: otra conexión espera o falla, no acepta lo mismo a la vez", () => {
    const ruta = nueva();
    const una = abrirBase(ruta, { esperaMs: 0 });
    const otra = abrirBase(ruta, { esperaMs: 0 });
    const a = new AlmacenSqlite(una, "v1");
    const b = new AlmacenSqlite(otra, "v1");
    let intento: unknown = null;
    a.transaccion(() => {
      a.crearEntidad("expense", "e1");
      try { b.transaccion(() => b.crearEntidad("expense", "e1")); } catch (e) { intento = e; }
    });
    expect((intento as { code?: string } | null)?.code).toBe("SQLITE_BUSY");
    // el bloqueo se toma al empezar, aunque la otra transacción solo lea
    const lector = new AlmacenSqlite(otra, "v1");
    let lectura: unknown = null;
    a.transaccion(() => {
      a.crearEntidad("expense", "e7");
      try { lector.transaccion(() => lector.entidadExiste("expense", "e7")); } catch (e) { lectura = e; }
    });
    expect((lectura as { code?: string } | null)?.code).toBe("SQLITE_BUSY");
    expect(b.entidadExiste("expense", "e1")).toBe(true); // ya confirmada por la primera
    una.close();
    otra.close();
  });

  it("una transacción dentro de otra forma parte de ella y todo se deshace junto", () => {
    const a = new AlmacenSqlite(abrirBase(":memory:"), "v1");
    expect(() => a.transaccion(() => {
      a.crearEntidad("expense", "e1");
      a.transaccion(() => a.crearEntidad("expense", "e2"));
      throw new Error("falla");
    })).toThrow("falla");
    expect(a.contarEntidades("expense")).toBe(0);
  });
});
