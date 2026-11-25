import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { IdentidadSqlite } from "../../../src/almacen/identidad/identidadSqlite.js";
import { ViajeCompletoError, type NuevaInvitacion, type NuevoDispositivo } from "../../../src/dominio/identidad/identidad.js";

const carpetas: string[] = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });

const MAX = 4;
/** Una huella válida (64 hexadecimales en minúscula) distinta para cada n. */
const huella = (n: number): string => n.toString(16).padStart(64, "0");
const nuevo = () => new IdentidadSqlite(abrirBase(":memory:"));
const disp = (n: number, extra: Partial<NuevoDispositivo> = {}): NuevoDispositivo => ({ deviceId: `d${n}`, tripId: "viaje", memberId: `m${n}`, nombre: `Celular ${n}`, tokenHash: huella(n), creadoEn: 1000 + n, ...extra });
const inv = (n: number, extra: Partial<NuevaInvitacion> = {}): NuevaInvitacion => ({ invitationId: `i${n}`, tripId: "viaje", codigoHash: huella(1000 + n), reemplazaMemberId: null, creadaEn: 1000, venceEn: 1000 + 86_400_000, porAdministrador: false, ...extra });
const crear = (r: IdentidadSqlite, d: NuevoDispositivo) => r.crearDispositivo(d, 100);

describe("identidad: dispositivos", () => {
  it("crear y buscar por id y por la huella del token, con todos sus campos", () => {
    const r = nuevo();
    expect(r.dispositivo("d1")).toBeNull();
    expect(r.dispositivoPorToken(huella(1))).toBeNull();
    crear(r, disp(1));
    const esperado = { deviceId: "d1", tripId: "viaje", memberId: "m1", nombre: "Celular 1", creadoEn: 1001, revocadoEn: null, ultimoVistoEn: null, ultimoSeqVisto: 0, pendientes: 0 };
    expect(r.dispositivo("d1")).toEqual(esperado);
    expect(r.dispositivoPorToken(huella(1))).toEqual(esperado);
    expect(r.dispositivoPorToken(huella(2))).toBeNull();
    expect(r.dispositivo("d2")).toBeNull();
  });

  it("no se repite el dispositivo ni la huella del token, y no queda nada a medias", () => {
    const r = nuevo();
    crear(r, disp(1));
    expect(() => crear(r, disp(1, { memberId: "otro", tokenHash: huella(50) }))).toThrow(/UNIQUE/);
    expect(() => crear(r, disp(2, { tokenHash: huella(1) }))).toThrow(/UNIQUE/);
    expect(r.dispositivosDelViaje("viaje")).toHaveLength(1);
  });

  it("la huella debe ser SHA-256 en 64 hexadecimales en minúscula: un token en claro no se puede guardar", () => {
    const r = nuevo();
    for (const mala of ["token-secreto", "a".repeat(64).toUpperCase(), huella(1).slice(1), `${huella(1)}0`, `${huella(1).slice(1)}g`]) {
      expect(() => crear(r, disp(1, { tokenHash: mala })), JSON.stringify(mala)).toThrow(/CHECK/);
    }
    expect(() => crear(r, disp(1, { tokenHash: "" }))).toThrow(RangeError);
    crear(r, disp(1, { tokenHash: "abcdef0123456789".repeat(4) }));
  });

  it("un NUL no esquiva la forma de la huella: no puede haber basura detrás", () => {
    const r = nuevo();
    const base = "a".repeat(64);
    for (const mala of [`${base}\u0000ZZZ`, `${base}\u0000`, `${"a".repeat(10)}\u0000${"Z".repeat(53)}`, `\u0000${base}`, `${"a".repeat(63)}\u0000`]) {
      expect(() => crear(r, disp(1, { tokenHash: mala })), JSON.stringify(mala)).toThrow(/CHECK/);
    }
    // lo mismo en las huellas del código y de la IP, con el NUL al final, en el medio y al principio
    for (const mala of [`${base}\u0000ZZZ`, `${"a".repeat(10)}\u0000${"Z".repeat(53)}`, `\u0000${base}`, `${"a".repeat(63)}\u0000`]) {
      expect(() => r.crearInvitacion(inv(1, { codigoHash: mala })), JSON.stringify(mala)).toThrow(/CHECK/);
      expect(() => r.registrarIntento(mala, 1000, false), JSON.stringify(mala)).toThrow(/CHECK/);
    }
    expect(r.dispositivosDelViaje("viaje")).toEqual([]);
  });

  it("las entradas numéricas deben ser enteros seguros: ni texto, ni decimales, ni NaN, ni undefined, ni infinitos, ni BigInt", () => {
    const r = nuevo();
    const malos: unknown[] = ["abc", "5", 1.5, NaN, undefined, null, Infinity, -Infinity, 10n, 2 ** 53, true];
    crear(r, disp(1));
    crear(r, disp(2));
    r.crearInvitacion(inv(1));
    for (const malo of malos) {
      const x = malo as number;
      const nombre = String(typeof malo === "bigint" ? `${malo}n` : malo);
      expect(() => crear(r, disp(9, { creadoEn: x })), `creadoEn ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.crearDispositivo(disp(9), x), `maxActivos ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.revocar("d1", x), `revocar ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.registrarVisto("d1", x, 0, 0), `visto hora ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.registrarVisto("d1", 1, x, 0), `visto seq ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.registrarVisto("d1", 1, 0, x), `visto pendientes ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.crearInvitacion(inv(9, { creadaEn: x })), `invitación creada ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.crearInvitacion(inv(9, { venceEn: x })), `invitación vence ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.marcarUsada("i1", x, "d1"), `usada ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.registrarIntento(huella(9), x, false), `intento ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.intentosFallidos(huella(9), x), `fallidos ${nombre}`).toThrow(/entero seguro/);
      expect(() => r.limpiarIntentos(x), `limpiar ${nombre}`).toThrow(/entero seguro/);
    }
    // y no tocaron nada
    expect(r.dispositivosDelViaje("viaje").map((d) => [d.deviceId, d.revocadoEn, d.ultimoVistoEn])).toEqual([["d1", null, null], ["d2", null, null]]);
    expect(r.invitacionPorCodigo(huella(1001))?.usadaEn).toBeNull();
    expect(r.invitacionPorCodigo(huella(1009))).toBeNull();
  });

  it("revocar con una hora inválida no revoca en silencio: falla y el dispositivo sigue activo", () => {
    const r = nuevo();
    crear(r, disp(1));
    expect(() => r.revocar("d1", NaN)).toThrow(RangeError);
    expect(r.contarActivos("viaje")).toBe(1);
    expect(r.dispositivo("d1")?.revocadoEn).toBeNull();
  });

  it("un máximo de activos inválido no anula el tope en silencio", () => {
    const r = nuevo();
    for (let i = 1; i <= 4; i++) r.crearDispositivo(disp(i), MAX);
    expect(() => r.crearDispositivo(disp(5), NaN)).toThrow(RangeError);
    expect(() => r.crearDispositivo(disp(5), undefined as unknown as number)).toThrow(RangeError);
    expect(r.contarActivos("viaje")).toBe(4);
  });

  it("el token no se guarda en claro: la tabla solo tiene la columna de la huella", () => {
    const db = abrirBase(":memory:");
    const columnas = (db.pragma("table_info(device)") as { name: string }[]).map((c) => c.name);
    expect(columnas).toContain("token_hash");
    expect(columnas).not.toContain("token");
  });

  it("los dispositivos del viaje salen del más antiguo al más nuevo, con los revocados, y sin mezclar viajes", () => {
    const r = nuevo();
    crear(r, disp(3, { creadoEn: 3000 }));
    crear(r, disp(1, { creadoEn: 1000 }));
    crear(r, disp(2, { creadoEn: 2000, tripId: "otro" }));
    crear(r, disp(4, { creadoEn: 1000 })); // mismo instante que d1: desempata el id
    r.revocar("d1", 5000);
    expect(r.dispositivosDelViaje("viaje").map((d) => d.deviceId)).toEqual(["d1", "d4", "d3"]);
    expect(r.dispositivosDelViaje("otro").map((d) => d.deviceId)).toEqual(["d2"]);
    expect(r.dispositivosDelViaje("nada")).toEqual([]);
  });

  it("contarActivos no cuenta los revocados ni los de otro viaje", () => {
    const r = nuevo();
    expect(r.contarActivos("viaje")).toBe(0);
    for (let i = 1; i <= 4; i++) crear(r, disp(i));
    crear(r, disp(9, { tripId: "otro" }));
    expect(r.contarActivos("viaje")).toBe(4);
    r.revocar("d2", 5000);
    expect(r.contarActivos("viaje")).toBe(3);
    expect(r.contarActivos("otro")).toBe(1);
  });

  it("el tope de activos se hace cumplir al crear, sin que el servicio tenga que contar aparte", () => {
    const r = nuevo();
    for (let i = 1; i <= MAX; i++) r.crearDispositivo(disp(i), MAX);
    expect(() => r.crearDispositivo(disp(5), MAX)).toThrow(ViajeCompletoError);
    expect(r.dispositivo("d5")).toBeNull();
    expect(r.contarActivos("viaje")).toBe(4);
    r.crearDispositivo(disp(6, { tripId: "otro" }), MAX); // el tope es por viaje
    r.revocar("d1", 5000); // un revocado libera un lugar
    r.crearDispositivo(disp(5), MAX);
    expect(r.contarActivos("viaje")).toBe(4);
    expect(() => r.crearDispositivo(disp(7, { tripId: "x" }), 0)).toThrow(ViajeCompletoError);
  });

  it("un integrante tiene un solo dispositivo activo: para reemplazarlo se revoca al viejo antes", () => {
    const r = nuevo();
    crear(r, disp(1, { memberId: "mama" }));
    expect(() => crear(r, disp(2, { memberId: "mama" }))).toThrow(/UNIQUE/);
    crear(r, disp(3, { memberId: "mama", tripId: "otro" })); // el mismo id en otro viaje no choca
    r.revocar("d1", 5000);
    crear(r, disp(2, { memberId: "mama" }));
    expect(r.dispositivosDelViaje("viaje").map((d) => d.deviceId)).toEqual(["d1", "d2"]);
  });

  it("revocar solo cambia a un dispositivo activo y conserva la primera hora", () => {
    const r = nuevo();
    crear(r, disp(1));
    crear(r, disp(2));
    expect(r.revocar("d1", 5000)).toBe(true);
    expect(r.revocar("d1", 9000)).toBe(false);
    expect(r.revocar("nada", 9000)).toBe(false);
    expect(r.dispositivo("d1")?.revocadoEn).toBe(5000);
    expect(r.dispositivo("d2")?.revocadoEn).toBeNull();
    expect(r.dispositivoPorToken(huella(1))?.revocadoEn).toBe(5000); // sigue encontrándose: el servicio decide qué responder
  });

  it("revocar nunca falla por el reloj: con la hora atrasada queda en la hora de creación", () => {
    const r = nuevo();
    crear(r, disp(1, { creadoEn: 2000 }));
    crear(r, disp(2, { creadoEn: 2000 }));
    crear(r, disp(3, { creadoEn: 2000 }));
    expect(r.revocar("d1", 1999)).toBe(true);
    expect(r.dispositivo("d1")?.revocadoEn).toBe(2000);
    expect(r.revocar("d2", 2000)).toBe(true);
    expect(r.dispositivo("d2")?.revocadoEn).toBe(2000);
    expect(r.revocar("d3", 2001)).toBe(true);
    expect(r.dispositivo("d3")?.revocadoEn).toBe(2001);
    expect(r.contarActivos("viaje")).toBe(0);
  });

  it("registrarVisto anota la hora, el último seq y los pendientes solo de ese dispositivo activo", () => {
    const r = nuevo();
    crear(r, disp(1));
    crear(r, disp(2));
    expect(r.registrarVisto("d1", 7000, 42, 3)).toBe(true);
    expect(r.dispositivo("d1")).toMatchObject({ ultimoVistoEn: 7000, ultimoSeqVisto: 42, pendientes: 3 });
    expect(r.dispositivo("d2")).toMatchObject({ ultimoVistoEn: null, ultimoSeqVisto: 0, pendientes: 0 });
    expect(r.registrarVisto("d1", 8000, 40, 0)).toBe(true); // vale lo último que informó
    expect(r.dispositivo("d1")).toMatchObject({ ultimoVistoEn: 8000, ultimoSeqVisto: 40, pendientes: 0 });
    expect(() => r.registrarVisto("d1", 9000, -1, 0)).toThrow(RangeError);
    expect(() => r.registrarVisto("d1", 9000, 0, -1)).toThrow(/negativo/);
    expect(r.dispositivo("d1")).toMatchObject({ ultimoVistoEn: 8000, ultimoSeqVisto: 40, pendientes: 0 });
    expect(r.registrarVisto("nada", 1, 1, 1)).toBe(false); // un dispositivo inexistente no falla ni crea nada
    expect(r.dispositivo("nada")).toBeNull();
  });

  it("registrarVisto no escribe sobre un dispositivo revocado", () => {
    const r = nuevo();
    crear(r, disp(1));
    r.registrarVisto("d1", 7000, 42, 3);
    r.revocar("d1", 7500);
    expect(r.registrarVisto("d1", 8000, 99, 9)).toBe(false);
    expect(r.dispositivo("d1")).toMatchObject({ ultimoVistoEn: 7000, ultimoSeqVisto: 42, pendientes: 3 });
  });
});

describe("identidad: invitaciones", () => {
  it("crear y buscar por la huella del código", () => {
    const r = nuevo();
    expect(r.invitacionPorCodigo(huella(1001))).toBeNull();
    r.crearInvitacion(inv(1, { reemplazaMemberId: "m7" }));
    expect(r.invitacionPorCodigo(huella(1001))).toEqual({ invitationId: "i1", tripId: "viaje", reemplazaMemberId: "m7", creadaEn: 1000, venceEn: 1000 + 86_400_000, usadaEn: null, usadaPorDeviceId: null });
    expect(r.invitacionPorCodigo(huella(1002))).toBeNull();
    r.crearInvitacion(inv(2));
    expect(r.invitacionPorCodigo(huella(1002))?.reemplazaMemberId).toBeNull();
  });

  it("no se repite la invitación ni la huella del código, debe vencer después de crearse y la huella debe tener la forma", () => {
    const r = nuevo();
    r.crearInvitacion(inv(1));
    expect(() => r.crearInvitacion(inv(1, { codigoHash: huella(77) }))).toThrow(/UNIQUE/);
    expect(() => r.crearInvitacion(inv(2, { codigoHash: huella(1001) }))).toThrow(/UNIQUE/);
    expect(() => r.crearInvitacion(inv(3, { venceEn: 1000 }))).toThrow(/CHECK/);
    expect(() => r.crearInvitacion(inv(4, { venceEn: 999 }))).toThrow(/CHECK/);
    for (const mala of ["ABCD2345", "b".repeat(64).toUpperCase(), huella(5).slice(1)]) {
      expect(() => r.crearInvitacion(inv(5, { codigoHash: mala })), mala).toThrow(/CHECK/);
    }
    expect(() => r.crearInvitacion(inv(5, { codigoHash: "" }))).toThrow(RangeError);
  });

  it("se usa una sola vez: el primero gana, y el dispositivo debe existir y ser del mismo viaje", () => {
    const r = nuevo();
    crear(r, disp(1));
    crear(r, disp(2));
    r.crearInvitacion(inv(1));
    expect(r.marcarUsada("i1", 2000, "fantasma")).toBe(false); // sin dispositivo no hay invitación usada
    expect(r.invitacionPorCodigo(huella(1001))).toMatchObject({ usadaEn: null, usadaPorDeviceId: null });
    expect(r.marcarUsada("i1", 2000, "d1")).toBe(true);
    expect(r.marcarUsada("i1", 2001, "d2")).toBe(false);
    expect(r.invitacionPorCodigo(huella(1001))).toMatchObject({ usadaEn: 2000, usadaPorDeviceId: "d1" });
    expect(r.marcarUsada("nada", 2000, "d1")).toBe(false);
  });

  it("un dispositivo revocado no puede usar la invitación", () => {
    const r = nuevo();
    crear(r, disp(1));
    r.revocar("d1", 1500);
    r.crearInvitacion(inv(1));
    expect(r.marcarUsada("i1", 2000, "d1")).toBe(false);
    expect(r.invitacionPorCodigo(huella(1001))?.usadaEn).toBeNull();
  });

  it("en una invitación de reemplazo, el dispositivo debe ser del integrante que se reemplaza; en una de integrante nuevo, de cualquiera", () => {
    const r = nuevo();
    crear(r, disp(1, { memberId: "mama" }));
    crear(r, disp(2, { memberId: "papa" }));
    r.crearInvitacion(inv(1, { reemplazaMemberId: "mama" }));
    r.crearInvitacion(inv(2, { reemplazaMemberId: null }));
    expect(r.marcarUsada("i1", 2000, "d2")).toBe(false); // el dispositivo es de otro integrante
    expect(r.invitacionPorCodigo(huella(1001))?.usadaEn).toBeNull();
    expect(r.marcarUsada("i1", 2000, "d1")).toBe(true);
    expect(r.marcarUsada("i2", 2000, "d2")).toBe(true);
  });

  it("con el reloj del servidor atrasado respecto de la creación, la invitación todavía no sirve y no falla", () => {
    const r = nuevo();
    crear(r, disp(1, { creadoEn: 5000 }));
    r.crearInvitacion(inv(1, { creadaEn: 5000, venceEn: 99_000 }));
    expect(r.marcarUsada("i1", 4999, "d1")).toBe(false);
    expect(r.invitacionPorCodigo(huella(1001))?.usadaEn).toBeNull();
    expect(r.marcarUsada("i1", 5000, "d1")).toBe(true);
  });

  it("un dispositivo creado antes que la invitación no puede usarla", () => {
    const r = nuevo();
    crear(r, disp(1, { creadoEn: 1500 }));
    r.crearInvitacion(inv(1, { creadaEn: 2000, venceEn: 99_000 }));
    expect(r.marcarUsada("i1", 2500, "d1")).toBe(false);
    expect(r.invitacionPorCodigo(huella(1001))?.usadaEn).toBeNull();
    crear(r, disp(2, { creadoEn: 2000 })); // el mismo instante de la invitación sí vale
    expect(r.marcarUsada("i1", 2500, "d2")).toBe(true);
  });

  it("un dispositivo consume a lo sumo una invitación", () => {
    const r = nuevo();
    crear(r, disp(1));
    r.crearInvitacion(inv(1));
    r.crearInvitacion(inv(2));
    expect(r.marcarUsada("i1", 2000, "d1")).toBe(true);
    expect(r.marcarUsada("i2", 2000, "d1")).toBe(false);
    expect(r.invitacionPorCodigo(huella(1002))).toMatchObject({ usadaEn: null, usadaPorDeviceId: null });
  });

  it("el resultado de un intento debe ser un booleano: un 1, un texto o un undefined no se registran en silencio", () => {
    const r = nuevo();
    for (const malo of [1, 0, "false", "true", undefined, null, {}, []]) {
      expect(() => r.registrarIntento(huella(9), 1000, malo as unknown as boolean), JSON.stringify(malo) ?? "undefined").toThrow(/booleano/);
    }
    expect(r.intentosFallidos(huella(9), 0)).toBe(0);
    r.registrarIntento(huella(9), 1000, false);
    r.registrarIntento(huella(9), 1001, true);
    expect(r.intentosFallidos(huella(9), 0)).toBe(1);
  });

  it("el error de viaje completo se identifica por su nombre además de por su clase (para los registros)", () => {
    const r = nuevo();
    r.crearDispositivo(disp(1), 1);
    try {
      r.crearDispositivo(disp(2), 1);
      expect.unreachable("debía lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(ViajeCompletoError);
      expect((e as Error).name).toBe("ViajeCompletoError");
    }
  });

  it("las reglas de datos las rechaza la base (CHECK o UNIQUE) y las de forma de tipo el repositorio (RangeError)", () => {
    const r = nuevo();
    expect(() => crear(r, disp(1, { tokenHash: "x".repeat(64) }))).toThrow(/CHECK/); // bien tipado, viola la forma de la huella
    expect(() => r.crearInvitacion(inv(1, { venceEn: 1000 }))).toThrow(/CHECK/); // bien tipada, vence junto con la creación
    expect(() => crear(r, disp(1, { tokenHash: 5 as unknown as string }))).toThrow(RangeError); // mal tipado
  });

  it("los identificadores y las huellas deben ser texto no vacío: un undefined o un número no busca ni crea en silencio", () => {
    const r = nuevo();
    crear(r, disp(1));
    r.crearInvitacion(inv(1));
    const malos: unknown[] = ["", 5, null, undefined, {}, [], true];
    for (const malo of malos) {
      const x = malo as string;
      const n = JSON.stringify(malo) ?? "undefined";
      expect(() => r.dispositivo(x), `dispositivo ${n}`).toThrow(RangeError);
      expect(() => r.dispositivoPorToken(x), `por token ${n}`).toThrow(RangeError);
      expect(() => r.dispositivosDelViaje(x), `del viaje ${n}`).toThrow(RangeError);
      expect(() => r.contarActivos(x), `activos ${n}`).toThrow(RangeError);
      expect(() => r.revocar(x, 1), `revocar ${n}`).toThrow(RangeError);
      expect(() => r.registrarVisto(x, 1, 0, 0), `visto ${n}`).toThrow(RangeError);
      expect(() => r.invitacionPorCodigo(x), `por código ${n}`).toThrow(RangeError);
      expect(() => r.marcarUsada(x, 2000, "d1"), `usada invitación ${n}`).toThrow(RangeError);
      expect(() => r.marcarUsada("i1", 2000, x), `usada dispositivo ${n}`).toThrow(RangeError);
      expect(() => r.registrarIntento(x, 1, false), `intento ${n}`).toThrow(RangeError);
      expect(() => r.intentosFallidos(x, 0), `fallidos ${n}`).toThrow(RangeError);
      for (const campo of ["deviceId", "tripId", "memberId", "nombre", "tokenHash"] as const) {
        expect(() => crear(r, disp(9, { [campo]: x })), `crear ${campo} ${n}`).toThrow(RangeError);
      }
      for (const campo of ["invitationId", "tripId", "codigoHash"] as const) {
        expect(() => r.crearInvitacion(inv(9, { [campo]: x })), `invitación ${campo} ${n}`).toThrow(RangeError);
      }
      if (malo !== null) expect(() => r.crearInvitacion(inv(9, { reemplazaMemberId: x })), `reemplaza ${n}`).toThrow(RangeError);
    }
    // y no tocaron nada; un reemplazo sin integrante (null) sí es válido
    expect(r.dispositivosDelViaje("viaje")).toHaveLength(1);
    expect(r.invitacionPorCodigo(huella(1001))?.usadaEn).toBeNull();
    r.crearInvitacion(inv(2, { reemplazaMemberId: null }));
  });

  it("limitación conocida: el repositorio no sabe si un integrante existe ni si es nuevo; eso lo valida el servicio (member_id no es clave foránea)", () => {
    const r = nuevo();
    // una invitación de integrante nuevo se consume con un dispositivo de un integrante ya revocado: la identidad "resucita"
    crear(r, disp(1, { memberId: "bob" }));
    r.revocar("d1", 1500);
    crear(r, disp(2, { memberId: "bob" })); // el índice de un activo por integrante ya no estorba: el anterior está revocado
    r.crearInvitacion(inv(1, { reemplazaMemberId: null }));
    expect(r.marcarUsada("i1", 2000, "d2")).toBe(true);
    // una invitación de reemplazo para un integrante que nunca existió se consume con un dispositivo con ese member_id
    crear(r, disp(3, { memberId: "fantasma" }));
    r.crearInvitacion(inv(2, { reemplazaMemberId: "fantasma" }));
    expect(r.marcarUsada("i2", 2000, "d3")).toBe(true);
  });

  it("en el rescate del organizador la invitación se crea antes que el dispositivo nuevo: al revés no se puede usar", () => {
    const r = nuevo();
    crear(r, disp(1, { memberId: "organizador", creadoEn: 1000 }));
    r.revocar("d1", 1100); // se perdió el celular del organizador
    // al revés: el dispositivo nuevo nace ANTES que la invitación de rescate
    crear(r, disp(2, { memberId: "organizador", creadoEn: 1200 }));
    r.crearInvitacion(inv(1, { reemplazaMemberId: "organizador", creadaEn: 1300, venceEn: 99_000 }));
    expect(r.marcarUsada("i1", 1400, "d2")).toBe(false);
    // en orden: primero la invitación y después el dispositivo
    r.crearInvitacion(inv(2, { reemplazaMemberId: "organizador", creadaEn: 1300, venceEn: 99_000 }));
    r.revocar("d2", 1350);
    crear(r, disp(3, { memberId: "organizador", creadoEn: 1360 }));
    expect(r.marcarUsada("i2", 1400, "d3")).toBe(true);
  });

  it("un dispositivo de otro viaje no puede usar la invitación", () => {
    const r = nuevo();
    crear(r, disp(1, { tripId: "otro" }));
    r.crearInvitacion(inv(1));
    expect(r.marcarUsada("i1", 2000, "d1")).toBe(false);
    expect(r.invitacionPorCodigo(huella(1001))?.usadaEn).toBeNull();
  });

  it("no se puede usar una vencida: justo al vencer ya no sirve", () => {
    const r = nuevo();
    crear(r, disp(1));
    r.crearInvitacion(inv(1, { creadaEn: 1000, venceEn: 5000 }));
    r.crearInvitacion(inv(2, { creadaEn: 1000, venceEn: 5000 }));
    expect(r.marcarUsada("i1", 5000, "d1")).toBe(false);
    expect(r.invitacionPorCodigo(huella(1001))).toMatchObject({ usadaEn: null, usadaPorDeviceId: null });
    expect(r.marcarUsada("i2", 4999, "d1")).toBe(true);
  });
});

describe("identidad: intentos de unirse", () => {
  const ip = (c: string) => c.charCodeAt(0).toString(16).padStart(64, "0");

  it("cuenta solo los fallidos de esa IP desde el límite, inclusive", () => {
    const r = nuevo();
    r.registrarIntento(ip("a"), 1000, false);
    r.registrarIntento(ip("a"), 2000, false);
    r.registrarIntento(ip("a"), 3000, true);
    r.registrarIntento(ip("a"), 4000, false);
    r.registrarIntento(ip("b"), 4000, false);
    expect(r.intentosFallidos(ip("a"), 0)).toBe(3);
    expect(r.intentosFallidos(ip("a"), 2000)).toBe(2);
    expect(r.intentosFallidos(ip("a"), 2001)).toBe(1);
    expect(r.intentosFallidos(ip("a"), 4001)).toBe(0);
    expect(r.intentosFallidos(ip("b"), 0)).toBe(1);
    expect(r.intentosFallidos(ip("c"), 0)).toBe(0);
  });

  it("la huella de la IP debe tener la forma y la hora ser un entero", () => {
    const r = nuevo();
    expect(() => r.registrarIntento("1.2.3.4", 1000, false)).toThrow(/CHECK/);
    expect(() => r.registrarIntento(ip("a"), 1.5, false)).toThrow(/entero seguro/);
  });

  it("limpiar borra solo lo anterior al límite y dice cuántos", () => {
    const r = nuevo();
    for (const t of [1000, 2000, 3000]) r.registrarIntento(ip("a"), t, false);
    expect(r.limpiarIntentos(2000)).toBe(1);
    expect(r.intentosFallidos(ip("a"), 0)).toBe(2);
    expect(r.limpiarIntentos(0)).toBe(0);
    expect(r.limpiarIntentos(9999)).toBe(2);
  });
});

describe("identidad: transacciones y archivo", () => {
  it("si algo falla dentro de una transacción no queda nada, y una anidada forma parte de la de afuera", () => {
    const r = nuevo();
    expect(() => r.transaccion(() => {
      crear(r, disp(1));
      r.transaccion(() => crear(r, disp(2)));
      throw new Error("falla");
    })).toThrow("falla");
    expect(r.dispositivosDelViaje("viaje")).toEqual([]);
    expect(r.transaccion(() => crear(r, disp(3)))).toBeUndefined();
    expect(r.contarActivos("viaje")).toBe(1);
  });

  it("una transacción dentro de otra forma parte de ella: si la interna falla y la externa lo captura, lo escrito se conserva", () => {
    const r = nuevo();
    r.transaccion(() => {
      try {
        r.transaccion(() => {
          crear(r, disp(1));
          throw new Error("falla interna");
        });
      } catch {
        // la de afuera decide seguir
      }
      crear(r, disp(2));
    });
    expect(r.dispositivosDelViaje("viaje").map((d) => d.deviceId)).toEqual(["d1", "d2"]);
  });

  it("escribir toma el bloqueo desde el principio: otra conexión no puede ni leer dentro de su propia transacción de escritura", () => {
    const c = mkdtempSync(join(tmpdir(), "cuaderno-"));
    carpetas.push(c);
    const ruta = join(c, "identidad.db");
    const a = new IdentidadSqlite(abrirBase(ruta, { esperaMs: 0 }));
    const b = new IdentidadSqlite(abrirBase(ruta, { esperaMs: 0 }));
    let error: unknown = null;
    a.transaccion(() => {
      crear(a, disp(1));
      try { b.transaccion(() => b.contarActivos("viaje")); } catch (e) { error = e; }
    });
    expect((error as { code?: string } | null)?.code).toBe("SQLITE_BUSY");
    expect(b.contarActivos("viaje")).toBe(1);
  });

  it("el conteo y el alta del tope son un solo paso: otra conexión no puede colarse entre los dos", () => {
    const c = mkdtempSync(join(tmpdir(), "cuaderno-"));
    carpetas.push(c);
    const ruta = join(c, "identidad.db");
    const otra = new IdentidadSqlite(abrirBase(ruta, { esperaMs: 0 }));
    // la segunda conexión intenta crear un dispositivo justo después de que la primera cuenta
    class ConCarrera extends IdentidadSqlite {
      colada = false;
      override contarActivos(tripId: string): number {
        const n = super.contarActivos(tripId);
        if (!this.colada) {
          this.colada = true;
          otra.crearDispositivo(disp(2), 1);
        }
        return n;
      }
    }
    const a = new ConCarrera(abrirBase(ruta, { esperaMs: 0 }));
    // con el paso atómico la otra conexión choca con el bloqueo; sin él, entrarían los dos y habría 2 activos con un tope de 1
    expect(() => a.crearDispositivo(disp(1), 1)).toThrow(/locked|busy/i);
    expect(a.contarActivos("viaje")).toBe(0);
    a.crearDispositivo(disp(1), 1);
    expect(a.contarActivos("viaje")).toBe(1);
  });

  it("reemplazar un celular: crear el nuevo, marcar usada la invitación y revocar al viejo en una transacción deja 4 activos", () => {
    const r = nuevo();
    for (let i = 1; i <= 4; i++) r.crearDispositivo(disp(i), MAX);
    r.crearInvitacion(inv(1, { reemplazaMemberId: "m1" }));
    r.transaccion(() => {
      r.revocar("d1", 5000);
      r.crearDispositivo(disp(5, { memberId: "m1" }), MAX);
      expect(r.marcarUsada("i1", 5000, "d5")).toBe(true);
    });
    expect(r.contarActivos("viaje")).toBe(4);
    expect(r.invitacionPorCodigo(huella(1001))).toMatchObject({ usadaPorDeviceId: "d5" });
    // si algo falla a mitad, se deshace todo junto: el viejo sigue activo y la invitación sin usar
    r.crearInvitacion(inv(2, { reemplazaMemberId: "m2" }));
    expect(() => r.transaccion(() => {
      r.revocar("d2", 6000);
      r.crearDispositivo(disp(6, { memberId: "m2", tokenHash: huella(5) }), MAX); // huella repetida: falla
      r.marcarUsada("i2", 6000, "d6");
    })).toThrow(/UNIQUE/);
    expect(r.dispositivo("d2")?.revocadoEn).toBeNull();
    expect(r.invitacionPorCodigo(huella(1002))?.usadaEn).toBeNull();
    expect(r.contarActivos("viaje")).toBe(4);
  });

  it("lo guardado sobrevive al cerrar y volver a abrir el archivo", () => {
    const c = mkdtempSync(join(tmpdir(), "cuaderno-"));
    carpetas.push(c);
    const ruta = join(c, "identidad.db");
    const a = abrirBase(ruta);
    const r = new IdentidadSqlite(a);
    crear(r, disp(1));
    r.crearInvitacion(inv(1));
    r.registrarIntento(huella(9), 1000, false);
    r.revocar("d1", 5000);
    a.close();
    const b = new IdentidadSqlite(abrirBase(ruta));
    expect(b.dispositivoPorToken(huella(1))?.revocadoEn).toBe(5000);
    expect(b.invitacionPorCodigo(huella(1001))?.invitationId).toBe("i1");
    expect(b.intentosFallidos(huella(9), 0)).toBe(1);
  });
});

describe("identidad: invitaciones pendientes", () => {
  it("cuenta solo las del organizador en ese viaje, sin usar, ya empezadas y sin vencer", () => {
    const r = nuevo();
    r.crearInvitacion(inv(1));
    r.crearInvitacion(inv(2, { porAdministrador: true }));
    r.crearInvitacion(inv(3, { tripId: "otro" }));
    r.crearInvitacion(inv(4, { creadaEn: 5000, venceEn: 9000 }));
    r.crearInvitacion(inv(5, { venceEn: 3000 }));
    crear(r, disp(6, { creadoEn: 1500 }));
    r.crearInvitacion(inv(6));
    expect(r.marcarUsada("i6", 2000, "d6")).toBe(true);
    expect(r.invitacionesPendientes("viaje", 2000)).toBe(2); // i1 y i5
    expect(r.invitacionesPendientes("viaje", 2999)).toBe(2);
    expect(r.invitacionesPendientes("viaje", 3000)).toBe(1); // venció i5
    expect(r.invitacionesPendientes("viaje", 5000)).toBe(2); // empezó i4
    expect(r.invitacionesPendientes("otro", 2000)).toBe(1);
  });

  it("guarda si la emitió el administrador", () => {
    const db = abrirBase(":memory:");
    const r = new IdentidadSqlite(db);
    r.crearInvitacion(inv(1, { porAdministrador: true }));
    r.crearInvitacion(inv(2));
    expect(db.prepare("SELECT invitation_id, por_administrador FROM invitation ORDER BY invitation_id").all()).toEqual([
      { invitation_id: "i1", por_administrador: 1 },
      { invitation_id: "i2", por_administrador: 0 },
    ]);
  });
});
