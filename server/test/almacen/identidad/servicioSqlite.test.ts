import type { Database } from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { AlmacenSqlite } from "../../../src/almacen/operaciones/almacenSqlite.js";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { servicioDeIdentidadSobre } from "../../../src/almacen/identidad/servicioSqlite.js";
import type { DatosCrearViaje } from "../../../src/dominio/identidad/servicioIdentidad.js";

const AHORA = 1802000000000;
const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const DATOS: DatosCrearViaje = { nombre: "Brasil", zonaHoraria: "America/Asuncion", monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$" }], nombreDispositivo: "Poco X7", apodo: "Papá", color: "#E8E4F3", emoji: "🧔" };

describe("servicio de identidad sobre SQLite", () => {
  it("las escrituras del viaje ocurren dentro de la transacción que abre la identidad, en la misma conexión", () => {
    const db = abrirBase(":memory:");
    const servicio = servicioDeIdentidadSobre(db, { pepper: PEPPER, ahora: () => AHORA });
    const original = AlmacenSqlite.prototype.guardarOp;
    const dentro: boolean[] = [];
    const espia = vi.spyOn(AlmacenSqlite.prototype, "guardarOp").mockImplementation(function (this: AlmacenSqlite, op) {
      dentro.push((this as unknown as { db: Database }).db.inTransaction);
      return original.call(this, op);
    });
    try {
      servicio.crearViaje(DATOS);
    } finally {
      espia.mockRestore();
    }
    expect(dentro).toEqual([true, true]); // las dos operaciones propias, ambas dentro de la transacción
    expect(db.inTransaction).toBe(false); // y no queda una abierta
  });

  it("crea un viaje y autentica a su dispositivo, con la hora y el azar que se le dan", () => {
    const db = abrirBase(":memory:");
    let n = 0;
    const servicio = servicioDeIdentidadSobre(db, { pepper: PEPPER, ahora: () => AHORA, aleatorio: (c) => Uint8Array.from({ length: c }, () => (n++ * 53 + 3) & 255) });
    const alta = servicio.crearViaje(DATOS);
    expect(alta.tripId.replace("-", "").slice(0, 12)).toBe(AHORA.toString(16).padStart(12, "0"));
    expect(servicio.autenticar(alta.token).tripId).toBe(alta.tripId);
    expect(new AlmacenSqlite(db, alta.tripId).leerCampo("trip", alta.tripId, "nombre")).toBe("Brasil");
  });

  it("con el mismo azar y la misma hora dos bases distintas dan los mismos identificadores y el mismo token (se usa el azar inyectado)", () => {
    const fuente = (): ((c: number) => Uint8Array) => {
      let n = 0;
      return (c) => Uint8Array.from({ length: c }, () => (n++ * 53 + 3) & 255);
    };
    const a = servicioDeIdentidadSobre(abrirBase(":memory:"), { pepper: PEPPER, ahora: () => AHORA, aleatorio: fuente() }).crearViaje(DATOS);
    const b = servicioDeIdentidadSobre(abrirBase(":memory:"), { pepper: PEPPER, ahora: () => AHORA, aleatorio: fuente() }).crearViaje(DATOS);
    expect(b).toEqual(a);
    const c = servicioDeIdentidadSobre(abrirBase(":memory:"), { pepper: PEPPER, ahora: () => AHORA + 1, aleatorio: fuente() }).crearViaje(DATOS);
    expect(c.tripId).not.toBe(a.tripId); // y la hora inyectada también cuenta
  });

  it("sin azar inyectado usa el del sistema y los tokens no se repiten", () => {
    const db = abrirBase(":memory:");
    const servicio = servicioDeIdentidadSobre(db, { pepper: PEPPER, ahora: () => AHORA });
    const a = servicio.crearViaje(DATOS);
    const b = servicio.crearViaje(DATOS);
    expect(a.token).not.toBe(b.token);
    expect(a.tripId).not.toBe(b.tripId);
  });
});
