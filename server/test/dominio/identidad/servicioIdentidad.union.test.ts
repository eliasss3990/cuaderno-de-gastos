import { describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../../src/almacen/operaciones/almacenSqlite.js";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { IdentidadSqlite } from "../../../src/almacen/identidad/identidadSqlite.js";
import { generarCodigo, huellaDeCodigo, huellaDeIp, type Aleatorio } from "../../../src/dominio/identidad/credenciales.js";
import {
  ErrorDeServicio,
  MAX_DISPOSITIVOS_ACTIVOS,
  MAX_INTENTOS_FALLIDOS,
  ServicioDeIdentidad,
  VENTANA_DE_INTENTOS_MS,
  VIGENCIA_DE_LA_INVITACION_MS,
  type Alta,
  type DatosCrearViaje,
  type DatosUnirse,
} from "../../../src/dominio/identidad/servicioIdentidad.js";

const AHORA = 1802000000000;
const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const IP = "203.0.113.7";

function azarDeterminista(): Aleatorio {
  let n = 0;
  return (cantidad) => Uint8Array.from({ length: cantidad }, () => (n++ * 37 + 11) & 255);
}

/** Un almacén que falla al escribir un campo cuando se le pide: para comprobar que unirse es todo o nada. */
class AlmacenQueFalla extends AlmacenSqlite {
  static fallar = false;
  override escribirCampo(t: string, id: string, c: string, v: Parameters<AlmacenSqlite["escribirCampo"]>[3], h: string): void {
    if (AlmacenQueFalla.fallar) throw new Error("falla inyectada");
    super.escribirCampo(t, id, c, v, h);
  }
}

/** Un repositorio cuya guarda final `marcarUsada` pierde la carrera (otro la consumió primero), para probar que se respeta. */
class IdentidadQuePierdeLaCarrera extends IdentidadSqlite {
  perder = false;
  override marcarUsada(...a: Parameters<IdentidadSqlite["marcarUsada"]>): boolean {
    return this.perder ? false : super.marcarUsada(...a);
  }
}

function entorno() {
  const db = abrirBase(":memory:");
  const identidad = new IdentidadQuePierdeLaCarrera(db);
  const reloj = { ahora: AHORA };
  const servicio = new ServicioDeIdentidad({ identidad, almacenDe: (id) => new AlmacenQueFalla(db, id), pepper: PEPPER, ahora: () => reloj.ahora, aleatorio: azarDeterminista() });
  const contar = (tabla: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;
  return { db, identidad, servicio, reloj, contar, almacen: (id: string) => new AlmacenSqlite(db, id) };
}

const VIAJE: DatosCrearViaje = {
  nombre: "Brasil 2027",
  zonaHoraria: "America/Asuncion",
  monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$" }],
  nombreDispositivo: "Poco X7 de Elías",
  apodo: "Papá",
  color: "#E8E4F3",
  emoji: "🧔",
};
const NUEVO = { nombreDispositivo: "Celular de Ana", apodo: "Ana", color: "#FFE4E1", emoji: "👩" };

/** Un viaje con su organizador ya autenticado, listo para invitar. */
function viajeConOrganizador() {
  const e = entorno();
  const alta = e.servicio.crearViaje(VIAJE);
  const organizador = e.servicio.autenticar(alta.token);
  return { ...e, alta, organizador };
}

function unirNuevo(e: ReturnType<typeof viajeConOrganizador>, extra: Partial<DatosUnirse> = {}): Alta {
  const { codigo } = e.servicio.invitar(e.organizador);
  return e.servicio.unirse({ codigo, ip: IP, ...NUEVO, ...extra });
}

function codigoDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorDeServicio) return e.codigo;
    throw e;
  }
  return "sin error";
}

describe("las reglas fijas", () => {
  it("una invitación vale 24 horas, 5 fallos en 15 minutos bloquean y un viaje admite 4 dispositivos (escritos aquí a propósito, no importados)", () => {
    expect(VIGENCIA_DE_LA_INVITACION_MS).toBe(86_400_000);
    expect(VENTANA_DE_INTENTOS_MS).toBe(900_000);
    expect(MAX_INTENTOS_FALLIDOS).toBe(5);
    expect(MAX_DISPOSITIVOS_ACTIVOS).toBe(4);
  });

  it("a los 15 minutos exactos todavía cuentan y un milisegundo después ya no, con la ventana escrita en milisegundos", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    for (let i = 0; i < 5; i++) codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: IP, ...NUEVO }));
    e.reloj.ahora = AHORA + 900_000;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("demasiados_intentos");
    e.reloj.ahora = AHORA + 900_001;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("sin error");
  });
});

describe("invitar", () => {
  it("emite un código de 8 caracteres que vale 24 horas, y no lo guarda en claro", () => {
    const { servicio, organizador, db } = viajeConOrganizador();
    const inv = servicio.invitar(organizador);
    expect(inv.codigo).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(inv.venceEn).toBe(AHORA + VIGENCIA_DE_LA_INVITACION_MS);
    expect(VIGENCIA_DE_LA_INVITACION_MS).toBe(24 * 3600 * 1000);
    const filas = JSON.stringify(db.prepare("SELECT * FROM invitation").all());
    expect(filas).not.toContain(inv.codigo);
  });

  it("solo el organizador puede invitar", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    const actor = e.servicio.autenticar(ana.token);
    expect(codigoDe(() => e.servicio.invitar(actor))).toBe("solo_organizador");
    expect(e.contar("invitation")).toBe(1); // solo la de Ana
  });

  it("un reemplazo exige un integrante que exista en el viaje, y rechaza lo que no es texto", () => {
    const { servicio, organizador, alta } = viajeConOrganizador();
    expect(codigoDe(() => servicio.invitar(organizador, "no-existe"))).toBe("no_existe");
    expect(codigoDe(() => servicio.invitar(organizador, 7 as unknown as string))).toBe("formato_invalido");
    expect(codigoDe(() => servicio.invitar(organizador, ""))).toBe("formato_invalido");
    expect(codigoDe(() => servicio.invitar(organizador, alta.memberId))).toBe("sin error");
  });

  it("dos invitaciones seguidas tienen códigos distintos", () => {
    const { servicio, organizador } = viajeConOrganizador();
    expect(servicio.invitar(organizador).codigo).not.toBe(servicio.invitar(organizador).codigo);
  });
});

describe("unirse como integrante nuevo", () => {
  it("crea el integrante (no organizador), su dispositivo y un token que autentica", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    expect(ana.tripId).toBe(e.alta.tripId);
    expect(ana.memberId).not.toBe(e.alta.memberId);
    const a = e.almacen(ana.tripId);
    expect(a.leerCampo("member", ana.memberId, "apodo")).toBe("Ana");
    expect(a.leerCampo("member", ana.memberId, "color")).toBe("#FFE4E1");
    expect(a.leerCampo("member", ana.memberId, "emoji")).toBe("👩");
    expect(a.leerCampo("member", ana.memberId, "es_organizador")).toBe(0);
    expect(a.contarEntidades("member")).toBe(2);
    const d = e.servicio.autenticar(ana.token);
    expect(d.deviceId).toBe(ana.deviceId);
    expect(d.memberId).toBe(ana.memberId);
    expect(d.nombre).toBe("Celular de Ana");
  });

  it("escribe el member.join con el dispositivo nuevo y una marca de la hora del servidor con contador 0", () => {
    const e = viajeConOrganizador();
    e.reloj.ahora = AHORA + 5000;
    const ana = unirNuevo(e);
    const op = e.almacen(ana.tripId).instantanea().ops.find((o) => o.entidadId === ana.memberId);
    expect(op?.tipo).toBe("member.join");
    expect(op?.hlc).toBe(`${(AHORA + 5000).toString(16).padStart(13, "0")}-0000-${ana.deviceId}`);
  });

  it("marca la invitación como usada por ese dispositivo y anota el intento como acertado", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    const fila = e.db.prepare("SELECT usada_en, usada_por_device_id FROM invitation").get() as { used_at: number; used_by_device_id: string };
    expect(fila).toEqual({ usada_en: AHORA, usada_por_device_id: ana.deviceId });
    expect(e.db.prepare("SELECT ok FROM join_attempt").all()).toEqual([{ ok: 1 }]);
  });

  it("acepta el código como lo escribe una persona: minúsculas, espacios y guiones", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    const escrito = ` ${codigo.slice(0, 4).toLowerCase()} - ${codigo.slice(4).toLowerCase()} `;
    expect(codigoDe(() => e.servicio.unirse({ codigo: escrito, ip: IP, ...NUEVO }))).toBe("sin error");
  });

  it("una invitación sirve una sola vez", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    e.servicio.unirse({ codigo, ip: IP, ...NUEVO });
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO, nombreDispositivo: "Otro" }))).toBe("codigo_invalido");
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(2);
  });

  it("vale hasta justo antes de las 24 horas; a las 24 horas exactas ya venció", () => {
    const e = viajeConOrganizador();
    const a = e.servicio.invitar(e.organizador);
    const b = e.servicio.invitar(e.organizador);
    e.reloj.ahora = AHORA + VIGENCIA_DE_LA_INVITACION_MS - 1;
    expect(codigoDe(() => e.servicio.unirse({ codigo: a.codigo, ip: IP, ...NUEVO }))).toBe("sin error");
    e.reloj.ahora = AHORA + VIGENCIA_DE_LA_INVITACION_MS;
    expect(codigoDe(() => e.servicio.unirse({ codigo: b.codigo, ip: IP, ...NUEVO }))).toBe("codigo_invalido");
  });

  it("un código inexistente, mal formado o que no es texto da siempre el mismo error", () => {
    const e = viajeConOrganizador();
    e.servicio.invitar(e.organizador);
    const mensajes = new Set<string>();
    const malos = ["ABCDEFGH", "corto", "", "ÁÉÍÓÚÑÑÑ", null, 12345678, undefined, {}];
    for (const [i, codigo] of malos.entries()) {
      try {
        e.servicio.unirse({ codigo, ip: `198.51.100.${i + 1}`, ...NUEVO }); // una IP distinta por intento: así ninguno llega al límite
      } catch (err) {
        expect((err as ErrorDeServicio).codigo).toBe("codigo_invalido");
        mensajes.add((err as Error).message);
      }
    }
    expect(mensajes.size).toBe(1);
    expect(e.contar("join_attempt")).toBe(malos.length); // todos contaron como fallo
  });

  it("sin apodo, color ni emoji una invitación de integrante nuevo da el mismo error que un código malo y no se consume", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    const sinDatos = { codigo, ip: IP, nombreDispositivo: "Celular de Ana" };
    expect(codigoDe(() => e.servicio.unirse(sinDatos))).toBe("codigo_invalido");
    expect(e.db.prepare("SELECT usada_en FROM invitation").get()).toEqual({ usada_en: null });
    expect(e.contar("device")).toBe(1);
    expect(e.db.prepare("SELECT ok FROM join_attempt").all()).toEqual([{ ok: 0 }]); // cuenta como fallo
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("sin error"); // sigue sirviendo
  });

  it("apodo, color y emoji incompletos o inválidos son formato_invalido, sin consumir la invitación ni contar como fallo", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    for (const extra of [{ emoji: undefined }, { color: undefined, emoji: undefined }]) {
      expect(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO, ...extra })).toThrow("apodo, color y emoji van juntos");
    }
    for (const extra of [{ emoji: undefined }, { color: undefined, emoji: undefined }, { apodo: "" }, { color: "rojo" }, { nombreDispositivo: "   " }, { nombreDispositivo: "a​b" }]) {
      expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO, ...extra }))).toBe("formato_invalido");
    }
    expect(e.contar("join_attempt")).toBe(0);
    expect(e.db.prepare("SELECT usada_en FROM invitation").get()).toEqual({ usada_en: null });
    expect(e.contar("device")).toBe(1);
  });

  it("los datos para unirse deben ser un objeto", () => {
    const { servicio } = viajeConOrganizador();
    expect(codigoDe(() => servicio.unirse(null as unknown as DatosUnirse))).toBe("formato_invalido");
  });
});

describe("tope de dispositivos al unirse", () => {
  it("el quinto dispositivo da viaje_completo, no consume la invitación, no escribe nada y no cuenta como fallo", () => {
    const e = viajeConOrganizador();
    for (let i = 1; i < MAX_DISPOSITIVOS_ACTIVOS; i++) unirNuevo(e, { nombreDispositivo: `Celular ${i}`, apodo: `Ana${i}` });
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(MAX_DISPOSITIVOS_ACTIVOS);
    const { codigo } = e.servicio.invitar(e.organizador);
    const integrantes = e.almacen(e.alta.tripId).contarEntidades("member");
    const intentos = e.contar("join_attempt");
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("viaje_completo");
    expect(e.almacen(e.alta.tripId).contarEntidades("member")).toBe(integrantes);
    expect(e.contar("join_attempt")).toBe(intentos);
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM invitation WHERE usada_en IS NULL").get()).toEqual({ n: 1 });
    // liberado un lugar, la misma invitación sirve
    e.servicio.revocar(e.organizador, e.identidad.dispositivosDelViaje(e.alta.tripId)[1]!.deviceId);
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("sin error");
  });
});

describe("unirse para reemplazar un dispositivo", () => {
  it("revoca al dispositivo viejo del integrante, deja al integrante como estaba y no crea otro", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    const { codigo } = e.servicio.invitar(e.organizador, ana.memberId);
    const integrantes = e.almacen(e.alta.tripId).contarEntidades("member");
    const operaciones = e.contar("op");
    const nueva = e.servicio.unirse({ codigo, ip: IP, nombreDispositivo: "Celular nuevo de Ana" });
    expect(nueva.memberId).toBe(ana.memberId);
    expect(e.almacen(e.alta.tripId).contarEntidades("member")).toBe(integrantes);
    expect(e.contar("op")).toBe(operaciones); // un reemplazo no escribe operaciones
    expect(codigoDe(() => e.servicio.autenticar(ana.token))).toBe("dispositivo_revocado");
    expect(e.servicio.autenticar(nueva.token).memberId).toBe(ana.memberId);
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(2);
  });

  it("funciona con el viaje lleno: el viejo se revoca antes de crear el nuevo", () => {
    const e = viajeConOrganizador();
    const altas = [1, 2, 3].map((i) => unirNuevo(e, { nombreDispositivo: `Celular ${i}`, apodo: `Ana${i}` }));
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(MAX_DISPOSITIVOS_ACTIVOS);
    const { codigo } = e.servicio.invitar(e.organizador, altas[1]!.memberId);
    e.servicio.unirse({ codigo, ip: IP, nombreDispositivo: "Reemplazo" });
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(MAX_DISPOSITIVOS_ACTIVOS);
  });

  it("el reemplazo del organizador conserva el permiso de organizador (rescate)", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitarComoAdministrador(e.alta.tripId, e.alta.memberId);
    const nueva = e.servicio.unirse({ codigo, ip: IP, nombreDispositivo: "Celular nuevo" });
    const actor = e.servicio.autenticar(nueva.token);
    expect(codigoDe(() => e.servicio.invitar(actor))).toBe("sin error");
    expect(codigoDe(() => e.servicio.autenticar(e.alta.token))).toBe("dispositivo_revocado");
  });

  it("un reemplazo ignora el apodo, el color y el emoji que lleguen", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    const { codigo } = e.servicio.invitar(e.organizador, ana.memberId);
    const integrantes = e.almacen(e.alta.tripId).contarEntidades("member");
    const operaciones = e.contar("op");
    const nueva = e.servicio.unirse({ codigo, ip: IP, ...NUEVO, apodo: "Otro" });
    expect(nueva.memberId).toBe(ana.memberId);
    expect(e.almacen(e.alta.tripId).leerCampo("member", ana.memberId, "apodo")).toBe("Ana");
    expect(e.almacen(e.alta.tripId).contarEntidades("member")).toBe(integrantes);
    expect(e.contar("op")).toBe(operaciones);
  });
});

describe("invitarComoAdministrador", () => {
  it("un viaje que no existe da no_existe y no deja nada", () => {
    const e = entorno();
    expect(codigoDe(() => e.servicio.invitarComoAdministrador("no-existe", null))).toBe("no_existe");
    expect(e.contar("invitation")).toBe(0);
  });

  it("emite una invitación de integrante nuevo o de reemplazo, y rechaza un integrante inexistente", () => {
    const e = viajeConOrganizador();
    expect(e.servicio.invitarComoAdministrador(e.alta.tripId, null).codigo).toMatch(/^[2-9A-Z]{8}$/);
    expect(codigoDe(() => e.servicio.invitarComoAdministrador(e.alta.tripId, "no-existe"))).toBe("no_existe");
  });
});

describe("límite de intentos fallidos", () => {
  function fallar(e: ReturnType<typeof viajeConOrganizador>, ip: string, veces: number) {
    for (let i = 0; i < veces; i++) expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip, ...NUEVO }))).toBe("codigo_invalido");
  }

  it("con 5 fallos desde la misma red el siguiente da demasiados_intentos aunque el código sea bueno", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    fallar(e, IP, MAX_INTENTOS_FALLIDOS);
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("demasiados_intentos");
    expect(e.db.prepare("SELECT usada_en FROM invitation").get()).toEqual({ usada_en: null });
    expect(e.contar("join_attempt")).toBe(MAX_INTENTOS_FALLIDOS); // el bloqueado no se anota
  });

  it("con 4 fallos todavía deja intentar, y un acierto no cuenta como fallo", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    fallar(e, IP, MAX_INTENTOS_FALLIDOS - 1);
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("sin error");
    expect(e.identidad.intentosFallidos(huellaDeIp(IP, PEPPER), 0)).toBe(MAX_INTENTOS_FALLIDOS - 1);
  });

  it("otra red no se ve afectada", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    fallar(e, IP, MAX_INTENTOS_FALLIDOS);
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: "198.51.100.9", ...NUEVO }))).toBe("sin error");
  });

  it("las direcciones IPv6 de un mismo /64 comparten el límite, y la IPv4 mapeada cuenta como la IPv4", () => {
    const e = viajeConOrganizador();
    fallar(e, "2001:db8:1:2::1", 3);
    fallar(e, "2001:DB8:1:2:ffff::9", 2);
    expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: "2001:db8:1:2:aaaa::5", ...NUEVO }))).toBe("demasiados_intentos");
    expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: "2001:db8:1:3::1", ...NUEVO }))).toBe("codigo_invalido"); // otro /64
    fallar(e, "203.0.113.50", 3);
    fallar(e, "::ffff:203.0.113.50", 2);
    expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: "203.0.113.50", ...NUEVO }))).toBe("demasiados_intentos");
  });

  it("una IP que no se puede leer cuenta en un grupo propio y no tumba el pedido", () => {
    const e = viajeConOrganizador();
    for (const ip of ["basura", undefined, 42, ""]) expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip, ...NUEVO }))).toBe("codigo_invalido");
    fallar(e, "no-es-ip", 1);
    expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: null, ...NUEVO }))).toBe("demasiados_intentos");
  });

  it("el grupo de las IP ilegibles no se mezcla con una IP real (127.0.0.1, ::) ni se alcanza con un texto enorme", () => {
    const e = viajeConOrganizador();
    fallar(e, "no-es-ip", MAX_INTENTOS_FALLIDOS);
    // (0.0.0.0 es la dirección que usa internamente el grupo ilegible: nadie puede conectarse desde ella, así que no se prueba como "real")
    for (const real of ["127.0.0.1", "::"]) expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: real, ...NUEVO }))).toBe("codigo_invalido");
    // un texto muy largo cuenta como ilegible (el mismo grupo) y no se analiza
    expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: "1".repeat(100_000), ...NUEVO }))).toBe("demasiados_intentos");
    // una IPv6 válida con una zona larguísima NO se lee como esa IP (sin el tope se leería y compartiría su grupo)
    const e2 = viajeConOrganizador();
    fallar(e2, "fe80::1", MAX_INTENTOS_FALLIDOS);
    expect(codigoDe(() => e2.servicio.unirse({ codigo: "ABCDEFGH", ip: "fe80::1%" + "a".repeat(200), ...NUEVO }))).toBe("codigo_invalido");
    expect(codigoDe(() => e2.servicio.unirse({ codigo: "ABCDEFGH", ip: "fe80::1%" + "a".repeat(50), ...NUEVO }))).toBe("demasiados_intentos"); // con zona de largo razonable sí
    // el borde: 100 caracteres todavía se lee (comparte el grupo de fe80::1) y 101 ya no
    const e3 = viajeConOrganizador();
    fallar(e3, "fe80::1", MAX_INTENTOS_FALLIDOS);
    expect(codigoDe(() => e3.servicio.unirse({ codigo: "ABCDEFGH", ip: "fe80::1%" + "a".repeat(92), ...NUEVO }))).toBe("demasiados_intentos");
    expect(codigoDe(() => e3.servicio.unirse({ codigo: "ABCDEFGH", ip: "fe80::1%" + "a".repeat(93), ...NUEVO }))).toBe("codigo_invalido");
    // una IPv4 normal de hasta 15 caracteres y una IPv6 con zona de largo razonable siguen leyéndose
    expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: "255.255.255.255", ...NUEVO }))).toBe("codigo_invalido");
    expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: "fe80::1%eth0", ...NUEVO }))).toBe("codigo_invalido");
  });

  it("los fallos salen de la cuenta pasados 15 minutos (el borde inclusive todavía cuenta)", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    fallar(e, IP, MAX_INTENTOS_FALLIDOS);
    e.reloj.ahora = AHORA + VENTANA_DE_INTENTOS_MS;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("demasiados_intentos");
    e.reloj.ahora = AHORA + VENTANA_DE_INTENTOS_MS + 1;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("sin error");
  });

  it("formato_invalido no cuenta como fallo ni consume la invitación", () => {
    const e = viajeConOrganizador();
    for (let i = 0; i < 2 * MAX_INTENTOS_FALLIDOS; i++) expect(codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: IP, ...NUEVO, apodo: "" }))).toBe("formato_invalido");
    expect(e.contar("join_attempt")).toBe(0);
  });

  it("el fallo de un código bueno al que le faltan datos también cuenta (no deja distinguirlo de uno malo)", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    for (let i = 0; i < MAX_INTENTOS_FALLIDOS; i++) expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, nombreDispositivo: "X" }))).toBe("codigo_invalido");
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("demasiados_intentos");
  });
});

describe("con el viaje lleno una invitación que no vale sigue dando codigo_invalido", () => {
  /** Un viaje con 4 dispositivos activos y una invitación de integrante nuevo hecha antes de que se llenara. */
  function viajeLleno() {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    for (let i = 1; i < MAX_DISPOSITIVOS_ACTIVOS; i++) unirNuevo(e, { nombreDispositivo: `Celular ${i}`, apodo: `Ana${i}` });
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(MAX_DISPOSITIVOS_ACTIVOS);
    return { e, codigo };
  }

  it("vencida: no delata que el código existió, y cuenta como fallo", () => {
    const { e, codigo } = viajeLleno();
    e.reloj.ahora = AHORA + VIGENCIA_DE_LA_INVITACION_MS + 1;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("codigo_invalido");
    expect(e.db.prepare("SELECT ok FROM join_attempt WHERE ok = 0").all()).toHaveLength(1);
  });

  it("vencida en el instante exacto del borde", () => {
    const { e, codigo } = viajeLleno();
    e.reloj.ahora = AHORA + VIGENCIA_DE_LA_INVITACION_MS;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("codigo_invalido");
  });

  it("ya usada", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    e.servicio.unirse({ codigo, ip: IP, ...NUEVO });
    for (let i = 2; i < MAX_DISPOSITIVOS_ACTIVOS; i++) unirNuevo(e, { nombreDispositivo: `Celular ${i}`, apodo: `Ana${i}` });
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(MAX_DISPOSITIVOS_ACTIVOS);
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("codigo_invalido");
  });

  it("todavía no empezada (reloj del servidor atrasado)", () => {
    const { e, codigo } = viajeLleno();
    e.reloj.ahora = AHORA - 1;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("codigo_invalido");
    e.reloj.ahora = AHORA;
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("viaje_completo");
  });

  it("la misma invitación, todavía válida, sí da viaje_completo (para comprobar que la prueba distingue)", () => {
    const { e, codigo } = viajeLleno();
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("viaje_completo");
  });
});

describe("invitaciones que la base no deja consumir", () => {
  it("con el reloj del servidor atrasado la invitación todavía no sirve: da codigo_invalido, no escribe nada y cuenta como fallo", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador); // creada en AHORA
    e.reloj.ahora = AHORA - 1;
    const antes = { dispositivos: e.contar("device"), ops: e.contar("op") };
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("codigo_invalido");
    expect({ dispositivos: e.contar("device"), ops: e.contar("op") }).toEqual(antes);
    expect(e.db.prepare("SELECT usada_en FROM invitation").get()).toEqual({ usada_en: null });
    expect(e.db.prepare("SELECT ok FROM join_attempt").all()).toEqual([{ ok: 0 }]);
    e.reloj.ahora = AHORA; // vuelto el reloj, sirve
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("sin error");
  });

  it("si la base no la deja marcar como usada (otro la consumió primero) da codigo_invalido y no deja nada, ni siquiera el reemplazo", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    const nueva = e.servicio.invitar(e.organizador);
    const reemplazo = e.servicio.invitar(e.organizador, ana.memberId);
    const antes = { dispositivos: e.contar("device"), campos: e.contar("entity_field"), activos: e.identidad.contarActivos(e.alta.tripId) };
    e.identidad.perder = true;
    expect(codigoDe(() => e.servicio.unirse({ codigo: nueva.codigo, ip: IP, ...NUEVO }))).toBe("codigo_invalido");
    expect(codigoDe(() => e.servicio.unirse({ codigo: reemplazo.codigo, ip: IP, nombreDispositivo: "Nuevo" }))).toBe("codigo_invalido");
    e.identidad.perder = false;
    expect({ dispositivos: e.contar("device"), campos: e.contar("entity_field"), activos: e.identidad.contarActivos(e.alta.tripId) }).toEqual(antes);
    expect(e.servicio.autenticar(ana.token).deviceId).toBe(ana.deviceId); // el reemplazo deshecho no la revocó
    expect(e.db.prepare("SELECT ok FROM join_attempt WHERE ok = 0").all()).toHaveLength(2); // cuenta como fallo
  });

  it("una invitación de reemplazo de un integrante que no existe es un error del servidor, no de la persona, y no deja nada", () => {
    const e = viajeConOrganizador();
    const codigo = generarCodigo(azarDeterminista());
    e.identidad.crearInvitacion({ invitationId: "inv-rota", tripId: e.alta.tripId, codigoHash: huellaDeCodigo(codigo, PEPPER), reemplazaMemberId: "no-existe", creadaEn: AHORA, venceEn: AHORA + 1000, porAdministrador: false });
    const antes = { dispositivos: e.contar("device"), activos: e.identidad.contarActivos(e.alta.tripId) };
    expect(() => e.servicio.unirse({ codigo, ip: IP, nombreDispositivo: "Celular" })).toThrow(/no existe en el viaje/);
    expect({ dispositivos: e.contar("device"), activos: e.identidad.contarActivos(e.alta.tripId) }).toEqual(antes);
    expect(e.contar("join_attempt")).toBe(0);
  });
});

describe("unirse es todo o nada", () => {
  it("si falla al escribir el integrante no queda dispositivo, integrante ni invitación usada, y el fallo no cuenta", () => {
    const e = viajeConOrganizador();
    const { codigo } = e.servicio.invitar(e.organizador);
    const antes = { dispositivos: e.contar("device"), campos: e.contar("entity_field"), ops: e.contar("op") };
    AlmacenQueFalla.fallar = true;
    try {
      expect(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO })).toThrow("falla inyectada");
    } finally {
      AlmacenQueFalla.fallar = false;
    }
    expect({ dispositivos: e.contar("device"), campos: e.contar("entity_field"), ops: e.contar("op") }).toEqual(antes);
    expect(e.db.prepare("SELECT usada_en FROM invitation").get()).toEqual({ usada_en: null });
    expect(e.contar("join_attempt")).toBe(0); // un error del servidor no es un intento fallido de la persona
    expect(codigoDe(() => e.servicio.unirse({ codigo, ip: IP, ...NUEVO }))).toBe("sin error");
  });

  it("un reemplazo que falla no deja al viejo revocado", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    const { codigo } = e.servicio.invitar(e.organizador, ana.memberId);
    e.identidad.crearDispositivo = () => {
      throw new Error("falla inyectada al crear");
    };
    expect(() => e.servicio.unirse({ codigo, ip: IP, nombreDispositivo: "Nuevo" })).toThrow("falla inyectada al crear");
    expect(e.servicio.autenticar(ana.token).deviceId).toBe(ana.deviceId); // sigue activo
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(2);
  });
});

describe("revocar", () => {
  it("el organizador revoca otro dispositivo del viaje, que queda revocado y libera su lugar", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    e.reloj.ahora = AHORA + 1000;
    e.servicio.revocar(e.organizador, ana.deviceId);
    expect(codigoDe(() => e.servicio.autenticar(ana.token))).toBe("dispositivo_revocado");
    expect(e.identidad.dispositivo(ana.deviceId)?.revocadoEn).toBe(AHORA + 1000);
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(1);
  });

  it("solo el organizador puede revocar", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    const actor = e.servicio.autenticar(ana.token);
    expect(codigoDe(() => e.servicio.revocar(actor, e.alta.deviceId))).toBe("solo_organizador");
    expect(e.servicio.autenticar(e.alta.token).deviceId).toBe(e.alta.deviceId);
  });

  it("un dispositivo de otro viaje, uno inexistente o un valor que no es texto dan el mismo no_existe", () => {
    const e = viajeConOrganizador();
    const otro = e.servicio.crearViaje({ ...VIAJE, nombre: "Otro viaje" });
    const mensajes = new Set<string>();
    for (const id of [otro.deviceId, "no-existe", "", null, 7, undefined, {}]) {
      try {
        e.servicio.revocar(e.organizador, id);
        throw new Error("debía fallar");
      } catch (err) {
        expect((err as ErrorDeServicio).codigo).toBe("no_existe");
        mensajes.add((err as Error).message);
      }
    }
    expect(mensajes.size).toBe(1);
    expect(e.servicio.autenticar(otro.token).deviceId).toBe(otro.deviceId); // el de otro viaje sigue activo
  });

  it("revocar uno ya revocado no cambia la fecha", () => {
    const e = viajeConOrganizador();
    const ana = unirNuevo(e);
    e.reloj.ahora = AHORA + 1000;
    e.servicio.revocar(e.organizador, ana.deviceId);
    e.reloj.ahora = AHORA + 9000;
    e.servicio.revocar(e.organizador, ana.deviceId);
    expect(e.identidad.dispositivo(ana.deviceId)?.revocadoEn).toBe(AHORA + 1000);
  });

  it("el organizador puede revocar su propio dispositivo y recuperarlo con una invitación de rescate", () => {
    const e = viajeConOrganizador();
    e.servicio.revocar(e.organizador, e.alta.deviceId);
    expect(codigoDe(() => e.servicio.autenticar(e.alta.token))).toBe("dispositivo_revocado");
    const { codigo } = e.servicio.invitarComoAdministrador(e.alta.tripId, e.alta.memberId);
    const nueva = e.servicio.unirse({ codigo, ip: IP, nombreDispositivo: "Celular de rescate" });
    expect(nueva.memberId).toBe(e.alta.memberId);
    expect(e.identidad.contarActivos(e.alta.tripId)).toBe(1);
  });
});

describe("mantenimiento", () => {
  it("borra los intentos que salieron de la ventana y devuelve cuántos", () => {
    const e = viajeConOrganizador();
    for (let i = 0; i < 3; i++) codigoDe(() => e.servicio.unirse({ codigo: "ABCDEFGH", ip: IP, ...NUEVO }));
    e.reloj.ahora = AHORA + VENTANA_DE_INTENTOS_MS;
    expect(e.servicio.mantenimiento()).toBe(0); // el borde todavía cuenta
    e.reloj.ahora = AHORA + VENTANA_DE_INTENTOS_MS + 1;
    expect(e.servicio.mantenimiento()).toBe(3);
    expect(e.contar("join_attempt")).toBe(0);
  });
});
