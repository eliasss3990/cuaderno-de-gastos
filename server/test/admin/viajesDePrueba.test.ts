import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { borrarViaje } from "../../src/admin/borrarViaje.js";
import { cargarEjemplo, MAX_OPERACIONES_DEL_EJEMPLO } from "../../src/admin/cargarEjemplo.js";
import { verificarBase } from "../../src/admin/verificar.js";
import { abrirBase } from "../../src/almacen/base/base.js";
import { servicioDeIdentidadSobre } from "../../src/almacen/identidad/servicioSqlite.js";
import type { DatosCrearViaje } from "../../src/dominio/identidad/servicioIdentidad.js";

const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const AHORA = 1802000000000;
const DATOS: DatosCrearViaje = {
  nombre: "ejemplo-familia",
  zonaHoraria: "America/Asuncion",
  monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }],
  nombreDispositivo: "Celu",
  apodo: "Papá",
  color: "#E8E4F3",
  emoji: "🧔",
};
const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

function entorno() {
  const dir = mkdtempSync(join(tmpdir(), "viajes-de-prueba-"));
  carpetas.push(dir);
  const db = abrirBase(":memory:");
  const reloj = { ahora: AHORA };
  const servicio = servicioDeIdentidadSobre(db, { ahora: () => reloj.ahora, pepper: PEPPER });
  const filas = (tripId: string) =>
    ["entity_field", "entity", "entity_tombstone", "op", "trip_closed_interval", "invitation", "device"].reduce(
      (n, t) => n + (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE trip_id = ?`).get(tripId) as { n: number }).n,
      0,
    );
  const archivo = (contenido: unknown) => {
    const ruta = join(dir, `ops-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(ruta, typeof contenido === "string" ? contenido : JSON.stringify(contenido));
    return ruta;
  };
  return { dir, db, reloj, servicio, filas, archivo };
}

const categoria = (n: number) => ({
  type: "category.create",
  entity_type: "category",
  entity_id: `018f3a6e-7000-7000-8000-${String(n).padStart(12, "0")}`,
  payload: { nombre: `Cat ${n}`, color: "#E8E4F3", emoji: "🛣️" },
});

describe("borrarViaje", () => {
  it("borra todas las filas de un viaje humo- o ejemplo- y su carpeta de adjuntos, sin tocar otro viaje", async () => {
    const e = entorno();
    const prueba = e.servicio.crearViaje({ ...DATOS, nombre: "humo-2026" });
    e.servicio.invitarComoAdministrador(prueba.tripId, null);
    const real = e.servicio.crearViaje({ ...DATOS, nombre: "Brasil 2027" });
    mkdirSync(join(e.dir, prueba.tripId));
    writeFileSync(join(e.dir, prueba.tripId, "archivo"), "x");
    mkdirSync(join(e.dir, real.tripId));
    const antesReal = e.filas(real.tripId);
    const filas = await borrarViaje(e.db, prueba.tripId, e.dir);
    expect(filas).toBeGreaterThan(5);
    expect(e.filas(prueba.tripId)).toBe(0);
    expect(existsSync(join(e.dir, prueba.tripId))).toBe(false);
    expect(e.filas(real.tripId)).toBe(antesReal);
    expect(existsSync(join(e.dir, real.tripId))).toBe(true);
    const ejemplo = e.servicio.crearViaje(DATOS);
    await borrarViaje(e.db, ejemplo.tripId, e.dir); // sin carpeta de adjuntos también funciona
    expect(e.filas(ejemplo.tripId)).toBe(0);
    expect(verificarBase(e.db)).toEqual([]);
  });

  it("un viaje con un id que no es UUID no se borra aunque se llame humo- (el id arma una ruta): no sale de la carpeta", async () => {
    const e = entorno();
    const afuera = join(e.dir, "..", `${e.dir.split("/").pop() ?? ""}-afuera`);
    mkdirSync(afuera);
    carpetas.push(afuera);
    const malo = `../${afuera.split("/").pop() ?? ""}`;
    e.db.prepare("INSERT INTO entity (trip_id, tipo, id) VALUES (?, 'trip', ?)").run(malo, malo);
    e.db.prepare("INSERT INTO entity_field (trip_id, tipo, id, campo, valor, hlc) VALUES (?, 'trip', ?, 'nombre', '\"humo-trampa\"', 'h')").run(malo, malo);
    await expect(borrarViaje(e.db, malo, e.dir)).rejects.toThrow(expect.objectContaining({ codigo: "no_existe" }));
    expect(existsSync(afuera)).toBe(true);
  });

  it("se niega con un viaje real, con uno que no existe y con un id que no es un UUID", async () => {
    const e = entorno();
    const real = e.servicio.crearViaje({ ...DATOS, nombre: "Brasil humo-2027" });
    const antes = e.filas(real.tripId);
    await expect(borrarViaje(e.db, real.tripId, e.dir)).rejects.toThrow(/solo se borran viajes de prueba \(nombre que empiece con humo- o ejemplo-\)/);
    expect(e.filas(real.tripId)).toBe(antes);
    await expect(borrarViaje(e.db, "018f3a6e-1000-7000-8000-0000000000ff", e.dir)).rejects.toThrow(expect.objectContaining({ codigo: "no_existe" }));
    await expect(borrarViaje(e.db, "../../etc", e.dir)).rejects.toThrow(expect.objectContaining({ codigo: "no_existe" }));
  });
});

describe("cargarEjemplo", () => {
  it("aplica las operaciones del archivo con el organizador como autor, marcas del servidor y queda verificable", () => {
    const e = entorno();
    const v = e.servicio.crearViaje(DATOS);
    e.reloj.ahora += 1000;
    const r = cargarEjemplo(e.db, v.tripId, e.archivo({ ops: [categoria(1), categoria(2)] }), () => e.reloj.ahora);
    expect(r).toEqual({ lineas: ["cargadas 2 de 2 operaciones en ejemplo-familia"], rechazadas: 0 });
    const ops = e.db.prepare("SELECT device_id, member_id, aceptada_en, schema_version, hlc FROM op WHERE trip_id = ? AND type = 'category.create' ORDER BY server_seq").all(v.tripId) as {
      device_id: string;
      member_id: string;
      aceptada_en: number;
      schema_version: number;
      hlc: string;
    }[];
    expect(ops.map((o) => [o.device_id, o.member_id, o.aceptada_en, o.schema_version])).toEqual([
      [v.deviceId, v.memberId, AHORA + 1000, 1],
      [v.deviceId, v.memberId, AHORA + 1000, 1],
    ]);
    expect(ops[0]?.hlc.startsWith((AHORA + 1000).toString(16).padStart(13, "0"))).toBe(true);
    expect(verificarBase(e.db)).toEqual([]);
  });

  it("con el reloj sin avanzar, las marcas van después de las del organizador (no chocan)", () => {
    const e = entorno();
    const v = e.servicio.crearViaje(DATOS);
    expect(cargarEjemplo(e.db, v.tripId, e.archivo({ ops: [categoria(1)] }), () => AHORA).rechazadas).toBe(0);
    expect(cargarEjemplo(e.db, v.tripId, e.archivo({ ops: [categoria(2)] }), () => AHORA).rechazadas).toBe(0);
  });

  it("una operación rechazada no frena a las demás y se informa con su número y razón", () => {
    const e = entorno();
    const v = e.servicio.crearViaje(DATOS);
    const r = cargarEjemplo(e.db, v.tripId, e.archivo({ ops: [categoria(1), { ...categoria(2), payload: {} }, { ...categoria(3), type: "expense.update", entity_type: "expense", entity_id: "018f3a6e-2000-7000-8000-0000000000ff", payload: { concepto: "Cena" } }, categoria(4)] }), () => AHORA);
    expect(r).toEqual({
      lineas: ["cargadas 2 de 4 operaciones en ejemplo-familia", "operación 2 (category.create): formato", "operación 3 (expense.update): entidad_inexistente"],
      rechazadas: 2,
    });
  });

  it("un elemento que no es un objeto se rechaza por formato sin cortar la carga", () => {
    const e = entorno();
    const v = e.servicio.crearViaje(DATOS);
    const r = cargarEjemplo(e.db, v.tripId, e.archivo({ ops: [null, 7, categoria(1)] }), () => AHORA);
    expect(r).toEqual({ lineas: ["cargadas 1 de 3 operaciones en ejemplo-familia", "operación 1 (null): formato", "operación 2 (7): formato"], rechazadas: 2 });
  });

  it("en un viaje que ya terminó por fechas todo cae en el cierre: lo dice una vez y cómo armar el archivo", () => {
    const e = entorno();
    const v = e.servicio.crearViaje({ ...DATOS, fechaInicio: "2026-01-01", fechaFin: "2026-01-05" });
    e.reloj.ahora = Date.UTC(2027, 0, 1);
    const r = cargarEjemplo(e.db, v.tripId, e.archivo({ ops: [categoria(1), categoria(2)] }), () => e.reloj.ahora);
    expect(r).toEqual({
      lineas: [
        "cargadas 0 de 2 operaciones en ejemplo-familia",
        "operación 1 (category.create): viaje_cerrado",
        "el viaje ya terminó por fechas: crearlo sin fecha de fin y poner las fechas al final del archivo",
        "operación 2 (category.create): viaje_cerrado",
      ],
      rechazadas: 2,
    });
  });

  it("se niega con un viaje que no es de ejemplo, uno que no existe, uno sin dispositivos activos y archivos que no sirven", () => {
    const e = entorno();
    const real = e.servicio.crearViaje({ ...DATOS, nombre: "Brasil 2027" });
    expect(() => cargarEjemplo(e.db, real.tripId, e.archivo({ ops: [categoria(1)] }), () => AHORA)).toThrow(/solo se carga en un viaje de ejemplo/);
    expect(() => cargarEjemplo(e.db, "no-existe", e.archivo({ ops: [categoria(1)] }), () => AHORA)).toThrow(expect.objectContaining({ codigo: "no_existe" }));
    const v = e.servicio.crearViaje(DATOS);
    for (const malo of ["{no es json", JSON.stringify({ ops: [] }), JSON.stringify([categoria(1)]), JSON.stringify({ ops: Array(MAX_OPERACIONES_DEL_EJEMPLO + 1).fill(categoria(1)) })]) {
      expect(() => cargarEjemplo(e.db, v.tripId, e.archivo(malo), () => AHORA), malo.slice(0, 20)).toThrow(expect.objectContaining({ codigo: "formato_invalido" }));
    }
    expect(() => cargarEjemplo(e.db, v.tripId, join(e.dir, "no-existe.json"), () => AHORA)).toThrow(/no se puede leer el archivo .*ENOENT/);
    e.servicio.revocarComoAdministrador(v.deviceId);
    expect(() => cargarEjemplo(e.db, v.tripId, e.archivo({ ops: [categoria(1)] }), () => AHORA)).toThrow(/el viaje no tiene dispositivos activos/);
  });
});
