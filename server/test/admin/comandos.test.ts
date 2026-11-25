import { describe, expect, it } from "vitest";
import { abrirBase } from "../../src/almacen/base/base.js";
import { servicioDeIdentidadSobre } from "../../src/almacen/identidad/servicioSqlite.js";
import { ejecutar, ErrorDeUso, leerArgumentos } from "../../src/admin/comandos.js";
import { ErrorDeServicio, type DatosCrearViaje } from "../../src/dominio/identidad/servicioIdentidad.js";

const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const AHORA = 1802000000000;
const DATOS: DatosCrearViaje = {
  nombre: "Brasil 2027",
  zonaHoraria: "America/Asuncion",
  monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }],
  nombreDispositivo: "Celular de Papá",
  apodo: "Papá",
  color: "#E8E4F3",
  emoji: "🧔",
};

function entorno() {
  const db = abrirBase(":memory:");
  const reloj = { ahora: AHORA };
  const servicio = servicioDeIdentidadSobre(db, { ahora: () => reloj.ahora, pepper: PEPPER });
  return { db, reloj, servicio, correr: (...argv: string[]) => ejecutar(argv, { db, servicio, ahora: () => reloj.ahora }) };
}

describe("leerArgumentos", () => {
  it("separa el comando de sus opciones", () => {
    const r = leerArgumentos(["invitar", "--viaje", "v1", "--reemplaza", "m1"]);
    expect([r.comando, [...r.opciones]]).toEqual(["invitar", [["viaje", "v1"], ["reemplaza", "m1"]]]);
  });

  it("rechaza lo mal escrito con un mensaje que dice qué", () => {
    const casos: [string[], RegExp][] = [
      [[], /falta el comando/],
      [[""], /falta el comando/],
      [["borrar-todo"], /comando desconocido: borrar-todo/],
      [["toString"], /comando desconocido: toString/],
      [["invitar", "--viajes", "v1"], /opción desconocida para invitar: --viajes/],
      [["invitar", "viaje", "v1"], /se esperaba una opción --nombre/],
      [["invitar", "--viaje"], /falta el valor de --viaje/],
      [["invitar", "--viaje", ""], /falta el valor de --viaje/],
      [["invitar", "--viaje", "--reemplaza"], /falta el valor de --viaje/],
      [["invitar", "--viaje", "a", "--viaje", "b"], /opción repetida: --viaje/],
      [["viajes", "--viaje", "a"], /opción desconocida para viajes/],
    ];
    for (const [argv, mensaje] of casos) {
      expect(() => leerArgumentos(argv), argv.join(" ")).toThrow(ErrorDeUso);
      expect(() => leerArgumentos(argv), argv.join(" ")).toThrow(mensaje);
    }
  });
});

describe("comandos", () => {
  it("viajes sin ninguno lo dice", () => {
    expect(entorno().correr("viajes")).toEqual(["no hay viajes"]);
  });

  it("viajes lista cada viaje con su estado, sus integrantes y sus dispositivos, con los ids que piden los otros comandos", () => {
    const e = entorno();
    const a = e.servicio.crearViaje({ ...DATOS, fechaInicio: "2027-02-10", fechaFin: "2027-02-25" });
    const { codigo } = e.servicio.invitarComoAdministrador(a.tripId, null);
    e.reloj.ahora += 60_000;
    const ana = e.servicio.unirse({ codigo, nombreDispositivo: "Celu de Ana", apodo: "Ana", color: "#E8E4F3", emoji: "🧒", ip: "203.0.113.5" });
    e.reloj.ahora += 60_000;
    e.servicio.revocarComoAdministrador(ana.deviceId);
    const integrantes = [
      `  integrante ${a.memberId}  "Papá"  organizador`,
      `  integrante ${ana.memberId}  "Ana"`,
    ].sort((x, y) => (x.slice(13, 49) < y.slice(13, 49) ? -1 : 1));
    expect(e.correr("viajes")).toEqual([
      `viaje ${a.tripId}  "Brasil 2027"  PLANIFICADO  operaciones 3  última ${new Date(AHORA + 60_000).toISOString()}`,
      ...integrantes,
      `  dispositivo ${a.deviceId}  "Celular de Papá"  de ${a.memberId}  activo`,
      `  dispositivo ${ana.deviceId}  "Celu de Ana"  de ${ana.memberId}  revocado ${new Date(AHORA + 120_000).toISOString()}`,
    ]);
  });

  it("viajes muestra el estado según las fechas y la hora del servidor, y ordena los viajes por id", () => {
    const e = entorno();
    const a = e.servicio.crearViaje({ ...DATOS, nombre: "En curso \"ya\"", fechaInicio: "2027-02-01" });
    const b = e.servicio.crearViaje({ ...DATOS, nombre: "Sin fechas" });
    e.reloj.ahora = Date.UTC(2027, 1, 5);
    const cabeceras = e.correr("viajes").filter((l) => l.startsWith("viaje "));
    expect(cabeceras).toEqual(
      [
        `viaje ${a.tripId}  "En curso \\"ya\\""  EN_CURSO  operaciones 2  última ${new Date(AHORA).toISOString()}`,
        `viaje ${b.tripId}  "Sin fechas"  PLANIFICADO  operaciones 2  última ${new Date(AHORA).toISOString()}`,
      ].sort(),
    );
  });

  it("invitar emite una invitación de rescate que sirve para unirse, y dice cuándo vence", () => {
    const e = entorno();
    const a = e.servicio.crearViaje(DATOS);
    const [codigo, vence] = e.correr("invitar", "--viaje", a.tripId);
    expect(vence).toBe(`vence: ${new Date(AHORA + 24 * 60 * 60 * 1000).toISOString()}`);
    expect(codigo).toMatch(/^código: [2-9A-HJKMNP-Z]{8}$/);
    const alta = e.servicio.unirse({ codigo: (codigo ?? "").slice("código: ".length), nombreDispositivo: "Nuevo", apodo: "Ana", color: "#E8E4F3", emoji: "🧒", ip: "203.0.113.5" });
    expect(alta.tripId).toBe(a.tripId);
  });

  it("invitar con --reemplaza deja la invitación atada a ese integrante; uno que no existe es no_existe", () => {
    const e = entorno();
    const a = e.servicio.crearViaje(DATOS);
    const [codigo] = e.correr("invitar", "--viaje", a.tripId, "--reemplaza", a.memberId);
    const alta = e.servicio.unirse({ codigo: (codigo ?? "").slice("código: ".length), nombreDispositivo: "Celular nuevo de Papá", ip: "203.0.113.5" });
    expect(alta.memberId).toBe(a.memberId);
    expect(() => e.correr("invitar", "--viaje", a.tripId, "--reemplaza", "no-existe")).toThrow(expect.objectContaining({ codigo: "no_existe" }));
  });

  it("invitar a un viaje que no existe es no_existe, y sin --viaje es un error de uso", () => {
    const e = entorno();
    expect(() => e.correr("invitar", "--viaje", "no-existe")).toThrow(ErrorDeServicio);
    expect(() => e.correr("invitar")).toThrow(/falta --viaje/);
  });

  it("revocar revoca el dispositivo (deja de autenticar) y repetirlo dice que ya estaba", () => {
    const e = entorno();
    const a = e.servicio.crearViaje(DATOS);
    expect(e.correr("revocar", "--dispositivo", a.deviceId)).toEqual([
      `revocado: ${a.deviceId} ("Celular de Papá") del viaje ${a.tripId}`,
      "si estaba conectado en vivo, lo nota al reconectar (y desde ahí recibe 401)",
    ]);
    expect(() => e.servicio.autenticar(a.token)).toThrow(expect.objectContaining({ codigo: "dispositivo_revocado" }));
    e.reloj.ahora += 5000;
    expect(e.correr("revocar", "--dispositivo", a.deviceId)).toEqual([`ya estaba revocado: ${a.deviceId} ("Celular de Papá") del viaje ${a.tripId}`]);
    expect(e.db.prepare("SELECT revocado_en AS r FROM device WHERE device_id = ?").get(a.deviceId)).toEqual({ r: AHORA }); // repetir no cambia la hora
  });

  it("revocar uno que no existe es no_existe, y sin --dispositivo es un error de uso", () => {
    const e = entorno();
    expect(() => e.correr("revocar", "--dispositivo", "no-existe")).toThrow(expect.objectContaining({ codigo: "no_existe" }));
    expect(() => e.correr("revocar")).toThrow(/falta --dispositivo/);
  });
});
