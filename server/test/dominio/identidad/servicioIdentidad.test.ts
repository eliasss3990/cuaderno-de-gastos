import type { Database } from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../../src/almacen/operaciones/almacenSqlite.js";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { IdentidadSqlite } from "../../../src/almacen/identidad/identidadSqlite.js";
import { huellaDeToken, type Aleatorio } from "../../../src/dominio/identidad/credenciales.js";
import { Ingesta } from "../../../src/dominio/operaciones/ingesta.js";
import type { NuevoDispositivo } from "../../../src/dominio/identidad/identidad.js";
import type { Json } from "../../../src/dominio/operaciones/operaciones.js";
import { ErrorDeServicio, MAX_DISPOSITIVOS_ACTIVOS, ServicioDeIdentidad, type DatosCrearViaje } from "../../../src/dominio/identidad/servicioIdentidad.js";

const carpetas: string[] = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });

const AHORA = 1802000000000;
/** El valor secreto de las huellas (32 bytes): solo para pruebas. */
const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Una fuente de azar determinista pero distinta en cada llamada (no es segura: solo para pruebas). */
function azarDeterminista(): Aleatorio {
  let n = 0;
  return (cantidad) => Uint8Array.from({ length: cantidad }, () => (n++ * 37 + 11) & 255);
}

class AlmacenQueFalla extends AlmacenSqlite {
  static restantes: number | null = null;
  static despues = false;
  private static contar(fase: "antes" | "despues"): void {
    if ((fase === "despues") !== AlmacenQueFalla.despues || AlmacenQueFalla.restantes === null) return;
    if (AlmacenQueFalla.restantes === 0) throw new Error("falla inyectada");
    AlmacenQueFalla.restantes -= 1;
  }
  override crearEntidad(t: string, id: string): void { AlmacenQueFalla.contar("antes"); super.crearEntidad(t, id); AlmacenQueFalla.contar("despues"); }
  override escribirCampo(t: string, id: string, c: string, v: Json, h: string): void { AlmacenQueFalla.contar("antes"); super.escribirCampo(t, id, c, v, h); AlmacenQueFalla.contar("despues"); }
  override guardarOp(op: Parameters<AlmacenSqlite["guardarOp"]>[0]): number { AlmacenQueFalla.contar("antes"); const n = super.guardarOp(op); AlmacenQueFalla.contar("despues"); return n; }
}

class IdentidadQueFalla extends IdentidadSqlite {
  fallar = false;
  override crearDispositivo(d: NuevoDispositivo, max: number): void {
    super.crearDispositivo(d, max);
    if (this.fallar) throw new Error("falla inyectada al crear el dispositivo");
  }
}

function entorno(fabrica?: (db: Database, id: string) => AlmacenSqlite) {
  const db = abrirBase(":memory:");
  const identidad = new IdentidadQueFalla(db);
  const reloj = { ahora: AHORA };
  const servicio = new ServicioDeIdentidad({ identidad, almacenDe: (id) => (fabrica ?? ((d, i) => new AlmacenSqlite(d, i)))(db, id), pepper: PEPPER, ahora: () => reloj.ahora, aleatorio: azarDeterminista() });
  const contar = (tabla: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;
  const vacio = () => ["entity", "entity_field", "entity_tombstone", "op", "device", "invitation"].every((t) => contar(t) === 0);
  return { db, identidad, servicio, reloj, contar, vacio, almacen: (id: string) => new AlmacenSqlite(db, id) };
}

const DATOS: DatosCrearViaje = {
  nombre: "Brasil 2027",
  zonaHoraria: "America/Asuncion",
  fechaInicio: "2027-02-10",
  fechaFin: "2027-02-25",
  monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }, { codigo: "BRL", decimales: 2, simbolo: "R$" }],
  nombreDispositivo: "Poco X7 de Elías",
  apodo: "Papá",
  color: "#E8E4F3",
  emoji: "🧔",
};

describe("crear un viaje", () => {
  it("devuelve identificadores UUID v7 de la hora del servidor y un token de 256 bits", () => {
    const { servicio } = entorno();
    const alta = servicio.crearViaje(DATOS);
    for (const id of [alta.tripId, alta.deviceId, alta.memberId]) {
      expect(id).toMatch(UUID_V7);
      expect(id.replace("-", "").slice(0, 12)).toBe(AHORA.toString(16).padStart(12, "0"));
    }
    expect(new Set([alta.tripId, alta.deviceId, alta.memberId]).size).toBe(3);
    expect(alta.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("deja el viaje con su plan, sus monedas, la categoría Otro y al organizador", () => {
    const { servicio, almacen } = entorno();
    const { tripId, memberId } = servicio.crearViaje(DATOS);
    const a = almacen(tripId);
    expect(a.idDelViaje()).toBe(tripId);
    expect(a.leerCampo("trip", tripId, "nombre")).toBe("Brasil 2027");
    expect(a.leerCampo("trip", tripId, "zona_horaria")).toBe("America/Asuncion");
    expect(a.leerCampo("trip", tripId, "fecha_inicio")).toBe("2027-02-10");
    expect(a.leerCampo("trip", tripId, "fecha_fin")).toBe("2027-02-25");
    expect(a.entidadExiste("trip_currency", "PYG")).toBe(true);
    expect(a.entidadExiste("trip_currency", "BRL")).toBe(true);
    expect(a.contarEntidades("trip_currency")).toBe(2);
    expect(a.entidadExiste("category", "otro")).toBe(true);
    expect(a.entidadExiste("member", memberId)).toBe(true);
    expect(a.leerCampo("member", memberId, "apodo")).toBe("Papá");
    expect(a.leerCampo("member", memberId, "color")).toBe("#E8E4F3");
    expect(a.leerCampo("member", memberId, "emoji")).toBe("🧔");
    expect(a.leerCampo("member", memberId, "es_organizador")).toBe(1);
    expect(a.contarEntidades("member")).toBe(1);
  });

  it("escribe las dos primeras operaciones con el dispositivo nuevo y las marcas de la hora del servidor, contadores 0 y 1", () => {
    const { servicio, almacen } = entorno();
    const { tripId, deviceId, memberId } = servicio.crearViaje(DATOS);
    const a = almacen(tripId);
    const ops = [...a.instantanea().ops].sort((x, y) => (x.hlc < y.hlc ? -1 : 1));
    expect(ops.map((o) => o.tipo)).toEqual(["trip.create", "member.join"]);
    expect(ops.map((o) => o.entidadId)).toEqual([tripId, memberId]);
    const marca = (c: number) => `${AHORA.toString(16).padStart(13, "0")}-${c.toString(16).padStart(4, "0")}-${deviceId}`;
    expect(ops.map((o) => o.hlc)).toEqual([marca(0), marca(1)]);
    expect(a.secuencias()).toEqual([1, 2]);
    expect(a.buscarOp(ops[0]!.opId)).toEqual({ seq: 1, hlc: marca(0) });
    expect(a.ultimaMarcaDe(deviceId)).toBe(marca(1)); // las marcas siguientes del dispositivo continúan desde acá
    for (const o of ops) expect(o.opId).toMatch(UUID_V7);
  });

  it("guarda al dispositivo con su nombre recortado y se autentica con el token que se entregó", () => {
    const { servicio, identidad } = entorno();
    const alta = servicio.crearViaje({ ...DATOS, nombreDispositivo: "  Poco X7  " });
    expect(identidad.dispositivo(alta.deviceId)).toEqual({ deviceId: alta.deviceId, tripId: alta.tripId, memberId: alta.memberId, nombre: "Poco X7", creadoEn: AHORA, revocadoEn: null, ultimoVistoEn: null, ultimoSeqVisto: 0, pendientes: 0 });
    expect(servicio.autenticar(alta.token)).toEqual(identidad.dispositivo(alta.deviceId));
  });

  it("el token no queda guardado en ninguna parte de la base: solo su huella", () => {
    const { servicio, db, identidad } = entorno();
    const { token, deviceId } = servicio.crearViaje(DATOS);
    const tablas = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    for (const tabla of tablas) expect(JSON.stringify(db.prepare(`SELECT * FROM ${tabla}`).all()), tabla).not.toContain(token);
    expect(identidad.dispositivoPorToken(huellaDeToken(token))?.deviceId).toBe(deviceId);
  });

  it("las fechas pueden faltar o ser null", () => {
    const { servicio, almacen } = entorno();
    const sinFechas = servicio.crearViaje({ ...DATOS, fechaInicio: undefined, fechaFin: undefined });
    expect(almacen(sinFechas.tripId).leerCampo("trip", sinFechas.tripId, "fecha_inicio")).toBeUndefined();
    const conNull = servicio.crearViaje({ ...DATOS, fechaInicio: null, fechaFin: null });
    expect(almacen(conNull.tripId).leerCampo("trip", conNull.tripId, "fecha_inicio")).toBeNull();
    expect(almacen(conNull.tripId).leerCampo("trip", conNull.tripId, "fecha_fin")).toBeNull();
  });

  it("dos viajes en la misma base son independientes", () => {
    const { servicio, almacen, identidad } = entorno();
    const uno = servicio.crearViaje(DATOS);
    const otro = servicio.crearViaje({ ...DATOS, nombre: "Chile", apodo: "Mamá" });
    expect(uno.token).not.toBe(otro.token);
    expect(uno.tripId).not.toBe(otro.tripId);
    expect(servicio.autenticar(uno.token).tripId).toBe(uno.tripId);
    expect(servicio.autenticar(otro.token).tripId).toBe(otro.tripId);
    expect(almacen(uno.tripId).leerCampo("trip", uno.tripId, "nombre")).toBe("Brasil 2027");
    expect(almacen(otro.tripId).leerCampo("trip", otro.tripId, "nombre")).toBe("Chile");
    expect(almacen(uno.tripId).leerCampo("member", otro.memberId, "apodo")).toBeUndefined();
    expect(almacen(uno.tripId).secuencias()).toEqual([1, 2]);
    expect(identidad.contarActivos(uno.tripId)).toBe(1);
    expect(identidad.contarActivos(otro.tripId)).toBe(1);
  });
});

describe("crear un viaje: reglas fijas", () => {
  it("un viaje admite como máximo 4 dispositivos activos", () => {
    expect(MAX_DISPOSITIVOS_ACTIVOS).toBe(4);
  });

  it("si una operación propia no se acepta (por ejemplo con identificadores repetidos) no se crea el viaje y lo anterior queda intacto", () => {
    const db = abrirBase(":memory:");
    const identidad = new IdentidadSqlite(db);
    // cada creación hace 6 sorteos (viaje, integrante, dispositivo, token y dos operaciones); esta fuente los repite igual
    // en cada creación pero distintos entre sí, así la segunda creación choca con la primera en todos sus identificadores
    let sorteo = 0;
    const repetida: Aleatorio = (n) => {
      const k = sorteo++ % 6;
      return Uint8Array.from({ length: n }, (_, j) => (k * 40 + j * 3 + 5) & 255);
    };
    const servicio = new ServicioDeIdentidad({ identidad, almacenDe: (id) => new AlmacenSqlite(db, id), pepper: PEPPER, ahora: () => AHORA, aleatorio: repetida });
    const primero = servicio.crearViaje(DATOS);
    const contar = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const antes = [contar("entity"), contar("entity_field"), contar("op"), contar("device")];
    expect(() => servicio.crearViaje(DATOS)).toThrow(/la operación propia trip\.create no se aceptó/);
    expect([contar("entity"), contar("entity_field"), contar("op"), contar("device")]).toEqual(antes);
    expect(servicio.autenticar(primero.token).deviceId).toBe(primero.deviceId);
  });
});

describe("crear un viaje con datos inválidos", () => {
  const malos: [string, Partial<DatosCrearViaje> | { [k: string]: unknown }, string][] = [
    ["nombre vacío", { nombre: "" }, "nombre"],
    ["nombre que no es texto", { nombre: 5 }, "nombre"],
    ["zona inexistente", { zonaHoraria: "Mars/Phobos" }, "zona_horaria"],
    ["zona UTC sola", { zonaHoraria: "UTC" }, "zona_horaria"],
    ["fecha imposible", { fechaInicio: "2027-02-30" }, "fecha_inicio"],
    ["fin antes del inicio", { fechaInicio: "2027-02-25", fechaFin: "2027-02-10" }, "fecha_fin"],
    ["sin monedas", { monedas: [] }, "monedas"],
    ["moneda repetida", { monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$" }, { codigo: "BRL", decimales: 2, simbolo: "R$" }] }, "monedas"],
    ["código de moneda en minúscula", { monedas: [{ codigo: "brl", decimales: 2, simbolo: "R$" }] }, "monedas"],
    ["decimales de más", { monedas: [{ codigo: "BRL", decimales: 9, simbolo: "R$" }] }, "monedas"],
    ["color que no es #RRGGBB", { color: "rojo" }, "color"],
    ["color en minúscula", { color: "#e8e4f3" }, "color"],
    ["apodo vacío", { apodo: "" }, "apodo"],
    ["apodo con un carácter de control", { apodo: "Pa\u0007pá" }, "apodo"],
    ["emoji vacío", { emoji: "" }, "emoji"],
    ["dispositivo vacío", { nombreDispositivo: "" }, "nombreDispositivo"],
    ["dispositivo de solo espacios", { nombreDispositivo: "    " }, "nombreDispositivo"],
    ["dispositivo de 41 caracteres", { nombreDispositivo: "x".repeat(41) }, "nombreDispositivo"],
    ["dispositivo con un carácter de control", { nombreDispositivo: "Poco\u0000X7" }, "nombreDispositivo"],
    ["dispositivo con un salto de línea (es un texto de una línea)", { nombreDispositivo: "Poco\nX7" }, "nombreDispositivo"],
    ["dispositivo con un tabulador (es un texto de una línea)", { nombreDispositivo: "Poco\tX7" }, "nombreDispositivo"],
    ["dispositivo con una unidad Unicode suelta", { nombreDispositivo: "Poco\ud800" }, "nombreDispositivo"],
    ["dispositivo que no es texto", { nombreDispositivo: 5 }, "nombreDispositivo"],
    ["dispositivo nulo", { nombreDispositivo: null }, "nombreDispositivo"],
    ["dispositivo ausente", { nombreDispositivo: undefined }, "nombreDispositivo"],
  ];
  for (const [nombre, cambio, campo] of malos) {
    it(`${nombre}: formato_invalido que nombra el campo y no escribe nada`, () => {
      const { servicio, vacio } = entorno();
      let error: unknown;
      try { servicio.crearViaje({ ...DATOS, ...cambio } as DatosCrearViaje); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(ErrorDeServicio);
      expect((error as ErrorDeServicio).codigo).toBe("formato_invalido");
      expect((error as ErrorDeServicio).message).toContain(campo);
      expect(vacio()).toBe(true);
    });
  }

  it("los datos del viaje que no son un objeto dan formato_invalido y no un error de programación", () => {
    const { servicio, vacio } = entorno();
    for (const malo of [null, undefined, 5, "texto", true, []]) {
      let error: unknown;
      try { servicio.crearViaje(malo as unknown as DatosCrearViaje); } catch (e) { error = e; }
      expect(error, String(malo)).toBeInstanceOf(ErrorDeServicio);
      expect((error as ErrorDeServicio).codigo).toBe("formato_invalido");
    }
    expect(vacio()).toBe(true);
  });

  it("el nombre del dispositivo no admite caracteres invisibles ni separadores de línea, pero sí la unión de ancho cero de los emojis", () => {
    const { servicio, vacio, identidad } = entorno();
    const invisibles: [string, string][] = [["guion blando", "\u00ad"], ["espacio de ancho cero", "\u200b"], ["marca de izquierda a derecha", "\u200e"], ["marca de derecha a izquierda", "\u200f"], ["embebido LRE", "\u202a"], ["embebido RLE", "\u202b"], ["fin de formato", "\u202c"], ["anulación LRO", "\u202d"], ["anulación RLO", "\u202e"], ["unión de palabras", "\u2060"], ["aislado LRI", "\u2066"], ["aislado RLI", "\u2067"], ["aislado FSI", "\u2068"], ["fin de aislado", "\u2069"], ["BOM", "\ufeff"], ["relleno Hangul U+3164", "\u3164"], ["relleno Hangul U+115F", "\u115f"], ["relleno Hangul U+1160", "\u1160"], ["braille en blanco", "\u2800"], ["separador mongol", "\u180e"], ["separador de línea", "\u2028"], ["separador de párrafo", "\u2029"], ["marca de letra árabe", "\u061c"], ["relleno Hangul de ancho medio", "\uffa0"], ["operador invisible U+2061", "\u2061"], ["operador invisible U+2062", "\u2062"], ["operador invisible U+2063", "\u2063"], ["operador invisible U+2064", "\u2064"], ["formato obsoleto U+206A", "\u206a"], ["formato obsoleto U+206B", "\u206b"], ["formato obsoleto U+206C", "\u206c"], ["formato obsoleto U+206D", "\u206d"], ["formato obsoleto U+206E", "\u206e"], ["formato obsoleto U+206F", "\u206f"], ["unión de grafemas", "\u034f"], ["vocal inherente jemer U+17B4", "\u17b4"], ["vocal inherente jemer U+17B5", "\u17b5"], ["selector de variación suelto U+FE00", "\ufe00"], ["selector de variación U+FE0D", "\ufe0d"]];
    const rechazados: [string, string][] = [...invisibles.flatMap(([n, c]): [string, string][] => [[`${n} en el medio`, `Poco${c}X7`], [`${n} y nada más`, c], [`${n} repetido`, `${c}${c}`]]), ["solo espacios duros", "\u00a0\u00a0"], ["solo la unión de ancho cero", "\u200d"], ["solo la no-unión de ancho cero", "\u200c"], ["solo las dos", "\u200c\u200d"], ["unión, espacio y no-unión", "\u200d \u200c"], ["no-unión, espacio ideográfico y unión", "\u200c\u3000\u200d"]];
    for (const [nombre, valor] of rechazados) {
      let error: unknown;
      try { servicio.crearViaje({ ...DATOS, nombreDispositivo: valor }); } catch (e) { error = e; }
      expect(error, nombre).toBeInstanceOf(ErrorDeServicio);
      expect((error as ErrorDeServicio).codigo, nombre).toBe("formato_invalido");
      expect((error as ErrorDeServicio).message, nombre).toContain("nombreDispositivo: ");
      expect((error as ErrorDeServicio).message, nombre).toMatch(/invisibles|entre 1 y 40|espacios/); // dice por qué (un nombre de solo BOM se recorta a vacío)
    }
    // el mensaje distingue "tiene un invisible" de "no tiene nada visible"
    const mensaje = (v: string) => { try { servicio.crearViaje({ ...DATOS, nombreDispositivo: v }); } catch (e) { return (e as Error).message; } return ""; };
    expect(mensaje("Poco\u200bX7")).toBe("nombreDispositivo: no admite caracteres invisibles");
    expect(mensaje("\u200d \u200c")).toBe("nombreDispositivo: no puede ser solo espacios o caracteres invisibles");
    expect(vacio()).toBe(true);
    const familia = servicio.crearViaje({ ...DATOS, nombreDispositivo: "Celular de 👨‍👩‍👧" }); // con uniones de ancho cero (U+200D)
    expect(identidad.dispositivo(familia.deviceId)?.nombre).toBe("Celular de 👨‍👩‍👧");
    const conBom = servicio.crearViaje({ ...DATOS, nombreDispositivo: "\ufeffPoco X7\ufeff" }); // el BOM de alrededor se recorta como cualquier espacio
    expect(identidad.dispositivo(conBom.deviceId)?.nombre).toBe("Poco X7");
    const persa = servicio.crearViaje({ ...DATOS, nombreDispositivo: "می\u200cخواهم" }); // la no-unión de ancho cero es parte de la escritura persa
    expect(identidad.dispositivo(persa.deviceId)?.nombre).toBe("می\u200cخواهم");
  });

  it("el nombre del dispositivo acepta lo que un nombre legítimo necesita aunque Unicode lo marque como ignorable: el corazón rojo, las banderas de subdivisión y los nombres japoneses con variantes", () => {
    const { servicio, identidad } = entorno();
    const aceptados: [string, string][] = [
      ["corazón rojo con su selector de presentación", "Celular de \u2764\ufe0f"],
      ["carita en estilo de texto", "Poco \u263a\ufe0e"],
      ["bandera de Inglaterra (etiquetas U+E0067…U+E007F)", "Poco \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"],
      ["kanji con selector ideográfico U+E0101", "\u845b\u{E0101}の端末"],
      ["emoji de familia con uniones de ancho cero", "\u{1F468}\u200d\u{1F469}\u200d\u{1F467} móvil"],
      ["etiqueta suelta en el medio de un nombre (se acepta, no se ve pero no vacía el nombre)", "Poco\u{E0020}X7"],
    ];
    for (const [nombre, valor] of aceptados) {
      const alta = servicio.crearViaje({ ...DATOS, nombreDispositivo: valor });
      expect(identidad.dispositivo(alta.deviceId)?.nombre, nombre).toBe(valor);
    }
  });

  it("los bordes de lo exceptuado: los extremos de los rangos de etiquetas y de selectores ideográficos se aceptan y los vecinos sin asignar se rechazan", () => {
    const { servicio, identidad } = entorno();
    for (const cp of [0xe0020, 0xe007f, 0xe0100, 0xe01ef]) {
      const nombre = `Poco${String.fromCodePoint(cp)}X7`;
      expect(identidad.dispositivo(servicio.crearViaje({ ...DATOS, nombreDispositivo: nombre }).deviceId)?.nombre, cp.toString(16)).toBe(nombre);
    }
    for (const cp of [0xe0001, 0xe001f, 0xe0080, 0xe00ff, 0xe01f0]) {
      expect(() => servicio.crearViaje({ ...DATOS, nombreDispositivo: `Poco${String.fromCodePoint(cp)}X7` }), cp.toString(16)).toThrow(ErrorDeServicio);
    }
  });

  it("pero un nombre hecho solo de lo exceptuado no se ve y se rechaza", () => {
    const { servicio, vacio } = entorno();
    for (const [nombre, valor] of [["solo el selector de presentación", "\ufe0f"], ["solo el selector de texto", "\ufe0e"], ["solo una etiqueta", "\u{E0020}"], ["solo el selector ideográfico", "\u{E0101}"], ["todo lo exceptuado junto", "\u200c\u200d\ufe0e\ufe0f\u{E0020}\u{E0101}"], ["braille en blanco y espacios", " \u2800 "]] as const) {
      expect(() => servicio.crearViaje({ ...DATOS, nombreDispositivo: valor }), nombre).toThrow(ErrorDeServicio);
    }
    expect(vacio()).toBe(true);
  });

  it("limitación conocida: con un mismo archivo y dos conexiones el armado a mano falla por bloqueo y no deja nada (con dos bases distintas sí quedaría un viaje huérfano)", () => {
    const carpeta = mkdtempSync(join(tmpdir(), "cuaderno-"));
    carpetas.push(carpeta);
    const ruta = join(carpeta, "viaje.db");
    const dbA = abrirBase(ruta, { esperaMs: 0 });
    const dbB = abrirBase(ruta, { esperaMs: 0 });
    const servicio = new ServicioDeIdentidad({ identidad: new IdentidadSqlite(dbA), almacenDe: (id) => new AlmacenSqlite(dbB, id), pepper: PEPPER, ahora: () => AHORA, aleatorio: azarDeterminista() });
    let error: unknown;
    try { servicio.crearViaje(DATOS); } catch (e) { error = e; }
    expect((error as { code?: string } | undefined)?.code).toBe("SQLITE_BUSY");
    const n = (db: Database, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    for (const db of [dbA, dbB]) for (const t of ["entity", "op", "device"]) expect(n(db, t), t).toBe(0);
  });

  it("un reloj del servidor inválido es un error del servidor (RangeError), no del cliente, y no escribe nada", () => {
    const db = abrirBase(":memory:");
    const servicio = new ServicioDeIdentidad({ identidad: new IdentidadSqlite(db), almacenDe: (id) => new AlmacenSqlite(db, id), pepper: PEPPER, ahora: () => NaN, aleatorio: azarDeterminista() });
    let error: unknown;
    try { servicio.crearViaje(DATOS); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(ErrorDeServicio);
    for (const t of ["entity", "op", "device"]) expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0);
  });

  it("limitación conocida: un viaje con fecha de fin pasada se crea igual (sus dos operaciones son propias) y nace cerrado por fechas para la ingesta", () => {
    const { servicio, almacen, db } = entorno();
    const alta = servicio.crearViaje({ ...DATOS, fechaInicio: "2019-12-20", fechaFin: "2020-01-02" });
    const ingesta = new Ingesta(almacen(alta.tripId), () => AHORA);
    const hlc = `${AHORA.toString(16).padStart(13, "0")}-0005-${alta.deviceId}`;
    const r = ingesta.procesar({ opId: "018f3a6e-9000-7000-8000-000000000001", tipo: "member.update", entidadTipo: "member", entidadId: alta.memberId, hlc, payload: { apodo: "Papi" } });
    expect(r).toEqual({ estado: "rejected", razon: "viaje_cerrado" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM trip_closed_interval").get() as { n: number }).n).toBe(1);
  });

  it("limitación conocida: si el repositorio de identidad y los almacenes usan conexiones distintas no hay atomicidad (por eso existe la fábrica servicioDeIdentidadSobre)", () => {
    const dbIdentidad = abrirBase(":memory:");
    const dbViajes = abrirBase(":memory:");
    const identidad = new IdentidadQueFalla(dbIdentidad);
    const servicio = new ServicioDeIdentidad({ identidad, almacenDe: (id) => new AlmacenSqlite(dbViajes, id), pepper: PEPPER, ahora: () => AHORA, aleatorio: azarDeterminista() });
    identidad.fallar = true;
    expect(() => servicio.crearViaje(DATOS)).toThrow(/falla inyectada/);
    const n = (db: Database, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(n(dbIdentidad, "device")).toBe(0); // el dispositivo se deshizo...
    expect(n(dbViajes, "op")).toBe(2); // ...pero el viaje quedó escrito en la otra conexión: un viaje huérfano
  });

  it("el nombre del dispositivo acepta exactamente 40 caracteres", () => {
    const { servicio, identidad } = entorno();
    const alta = servicio.crearViaje({ ...DATOS, nombreDispositivo: "x".repeat(40) });
    expect(identidad.dispositivo(alta.deviceId)?.nombre).toBe("x".repeat(40));
  });
});

describe("crear un viaje es todo o nada", () => {
  it("si falla cualquier escritura del viaje, antes o justo después, no queda nada y se puede reintentar", () => {
    let intentos = 0;
    for (const despues of [false, true]) {
      for (let k = 0; ; k++) {
        const e = entorno((db, id) => new AlmacenQueFalla(db, id));
        AlmacenQueFalla.despues = despues;
        AlmacenQueFalla.restantes = k;
        try {
          e.servicio.crearViaje(DATOS);
          AlmacenQueFalla.restantes = null;
          expect(e.contar("op")).toBe(2); // llegó al final sin fallar: ya se probaron todas las escrituras
          break;
        } catch {
          intentos += 1;
          AlmacenQueFalla.restantes = null;
          expect(e.vacio(), `falla ${k} (${despues ? "después" : "antes"})`).toBe(true);
          const alta = e.servicio.crearViaje(DATOS); // reintentar funciona
          expect(e.servicio.autenticar(alta.token).tripId).toBe(alta.tripId);
        }
      }
    }
    expect(intentos).toBeGreaterThan(20); // la prueba no es vacía
  });

  it("si falla al crear el dispositivo, también se deshacen el viaje y sus operaciones", () => {
    const e = entorno();
    e.identidad.fallar = true;
    expect(() => e.servicio.crearViaje(DATOS)).toThrow(/falla inyectada/);
    expect(e.vacio()).toBe(true);
    e.identidad.fallar = false;
    expect(e.servicio.crearViaje(DATOS).tripId).toMatch(UUID_V7);
  });
});

describe("autenticar", () => {
  it("devuelve el dispositivo del token", () => {
    const { servicio } = entorno();
    const alta = servicio.crearViaje(DATOS);
    const d = servicio.autenticar(alta.token);
    expect(d).toMatchObject({ deviceId: alta.deviceId, tripId: alta.tripId, memberId: alta.memberId, revocadoEn: null });
  });

  it("un token que falta, está vacío, no es texto, es demasiado largo o no existe da siempre el mismo error", () => {
    const { servicio } = entorno();
    const alta = servicio.crearViaje(DATOS);
    const malos: unknown[] = [undefined, null, "", 5, true, {}, [], [alta.token], "x".repeat(257), "no-existe", alta.token.toLowerCase(), alta.token.toUpperCase(), `${alta.token} `, ` ${alta.token}`, alta.token.slice(1), `${alta.token}A`];
    const mensajes = new Set<string>();
    for (const malo of malos) {
      let error: unknown;
      try { servicio.autenticar(malo); } catch (e) { error = e; }
      expect(error, JSON.stringify(malo)).toBeInstanceOf(ErrorDeServicio);
      expect((error as ErrorDeServicio).codigo, JSON.stringify(malo)).toBe("no_autorizado");
      mensajes.add((error as ErrorDeServicio).message);
    }
    expect(mensajes.size).toBe(1); // el mensaje no distingue "sin token" de "token inválido"
  });

  it("el mensaje de error no contiene el token", () => {
    const { servicio } = entorno();
    const alta = servicio.crearViaje(DATOS);
    let error: unknown;
    try { servicio.autenticar(`${alta.token}x`); } catch (e) { error = e; }
    expect((error as Error).message).not.toContain(alta.token);
  });

  it("un token de 256 caracteres todavía se mira y uno de 257 ni se hashea", () => {
    const { servicio } = entorno();
    expect(() => servicio.autenticar("x".repeat(256))).toThrow(/token inválido/);
    expect(() => servicio.autenticar("x".repeat(257))).toThrow(/token inválido/);
  });

  it("un dispositivo revocado da dispositivo_revocado y no escribe lo que informa", () => {
    const { servicio, identidad, reloj } = entorno();
    const alta = servicio.crearViaje(DATOS);
    reloj.ahora = AHORA + 5000;
    identidad.revocar(alta.deviceId, reloj.ahora);
    let error: unknown;
    try { servicio.autenticar(alta.token, { ultimoSeq: 9, pendientes: 9 }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ErrorDeServicio);
    expect((error as ErrorDeServicio).codigo).toBe("dispositivo_revocado");
    expect(identidad.dispositivo(alta.deviceId)).toMatchObject({ ultimoVistoEn: null, ultimoSeqVisto: 0, pendientes: 0 });
  });

  it("anota cuándo vio al dispositivo y lo que informó, si es válido", () => {
    const { servicio, identidad, reloj } = entorno();
    const alta = servicio.crearViaje(DATOS);
    reloj.ahora = AHORA + 7000;
    servicio.autenticar(alta.token, { ultimoSeq: 42, pendientes: 3 });
    expect(identidad.dispositivo(alta.deviceId)).toMatchObject({ ultimoVistoEn: AHORA + 7000, ultimoSeqVisto: 42, pendientes: 3 });
    reloj.ahora = AHORA + 8000;
    servicio.autenticar(alta.token, { ultimoSeq: 0, pendientes: 0 }); // cero es válido
    expect(identidad.dispositivo(alta.deviceId)).toMatchObject({ ultimoVistoEn: AHORA + 8000, ultimoSeqVisto: 0, pendientes: 0 });
  });

  it("lo que informa el celular y no es válido se ignora: el pedido no falla y no se anota nada", () => {
    const { servicio, identidad, reloj } = entorno();
    const alta = servicio.crearViaje(DATOS);
    reloj.ahora = AHORA + 9000;
    const invalidos: [unknown, unknown][] = [[NaN, 1], [1, NaN], [-1, 1], [1, -1], [1.5, 1], [1, 1.5], ["5", 1], [1, "5"], [undefined, 1], [1, undefined], [null, null], [2 ** 53, 1], [1, 2 ** 53]];
    for (const [ultimoSeq, pendientes] of invalidos) {
      expect(servicio.autenticar(alta.token, { ultimoSeq, pendientes }).deviceId, `${String(ultimoSeq)},${String(pendientes)}`).toBe(alta.deviceId);
    }
    expect(identidad.dispositivo(alta.deviceId)).toMatchObject({ ultimoVistoEn: null, ultimoSeqVisto: 0, pendientes: 0 });
    servicio.autenticar(alta.token); // sin nada que anotar
    expect(identidad.dispositivo(alta.deviceId)?.ultimoVistoEn).toBeNull();
  });

  it("devuelve el dispositivo como estaba antes de anotar lo informado en ese pedido", () => {
    const { servicio, identidad } = entorno();
    const alta = servicio.crearViaje(DATOS);
    expect(servicio.autenticar(alta.token, { ultimoSeq: 5, pendientes: 1 }).ultimoSeqVisto).toBe(0);
    expect(identidad.dispositivo(alta.deviceId)?.ultimoSeqVisto).toBe(5);
    expect(servicio.autenticar(alta.token, { ultimoSeq: 6, pendientes: 0 }).ultimoSeqVisto).toBe(5);
  });

  it("un visto nulo se ignora y no tumba el pedido", () => {
    const { servicio, identidad } = entorno();
    const alta = servicio.crearViaje(DATOS);
    expect(servicio.autenticar(alta.token, null as unknown as undefined).deviceId).toBe(alta.deviceId);
    expect(identidad.dispositivo(alta.deviceId)?.ultimoVistoEn).toBeNull();
  });

  it("cada dispositivo anota lo suyo", () => {
    const { servicio, identidad } = entorno();
    const a = servicio.crearViaje(DATOS);
    const b = servicio.crearViaje({ ...DATOS, apodo: "Mamá" });
    servicio.autenticar(a.token, { ultimoSeq: 5, pendientes: 1 });
    expect(identidad.dispositivo(a.deviceId)?.ultimoSeqVisto).toBe(5);
    expect(identidad.dispositivo(b.deviceId)?.ultimoSeqVisto).toBe(0);
  });
});

describe("el error del servicio", () => {
  it("es un Error con nombre y código", () => {
    const e = new ErrorDeServicio("no_existe", "nada");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ErrorDeServicio");
    expect(e.codigo).toBe("no_existe");
    expect(e.message).toBe("nada");
  });
});
