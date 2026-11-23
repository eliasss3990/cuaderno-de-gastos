import { describe, expect, it } from "vitest";
import { AlmacenSqlite } from "../../src/almacen/operaciones/almacenSqlite.js";
import { entornoApi, NUEVO, VIAJE, type Alta } from "../ayudas/entornoApi.js";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const codigoDe = (r: { json: () => unknown }) => (r.json() as { error: { codigo: string } }).error.codigo;

describe("POST /v1/trips", () => {
  it("crea el viaje, al organizador y su dispositivo, y responde 201 con los identificadores y el token", async () => {
    const { app } = entornoApi();
    const r = await app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE });
    expect(r.statusCode).toBe(201);
    const alta = r.json<Alta>();
    expect(Object.keys(alta).sort()).toEqual(["device_id", "member_id", "token", "trip_id"]);
    for (const id of [alta.trip_id, alta.device_id, alta.member_id]) expect(id).toMatch(UUID_V7);
    expect(alta.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.headers["content-type"]).toContain("application/json");
  });

  it("acepta las fechas (texto o nulas) y las deja en el viaje", async () => {
    const e = entornoApi();
    const a = await e.crearViaje({ ...VIAJE, fecha_inicio: "2027-02-10", fecha_fin: "2027-02-25" });
    const b = await e.crearViaje({ ...VIAJE, fecha_inicio: null, fecha_fin: null });
    const c = await e.crearViaje({ ...VIAJE, fecha_inicio: "2027-03-01" });
    expect(new Set([a.trip_id, b.trip_id, c.trip_id]).size).toBe(3);
  });

  it("el viaje queda con los datos enviados: el plan, las fechas, las monedas, el organizador y su dispositivo", async () => {
    const e = entornoApi();
    const alta = await e.crearViaje({
      ...VIAJE,
      fecha_inicio: "2027-02-10",
      fecha_fin: "2027-02-25",
      monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }, { codigo: "BRL", decimales: 2, simbolo: "R$" }],
      nombre_dispositivo: "Poco X7 de Elías",
    });
    const a = new AlmacenSqlite(e.db, alta.trip_id);
    expect(a.leerCampo("trip", alta.trip_id, "nombre")).toBe("Brasil 2027");
    expect(a.leerCampo("trip", alta.trip_id, "zona_horaria")).toBe("America/Asuncion");
    expect(a.leerCampo("trip", alta.trip_id, "fecha_inicio")).toBe("2027-02-10");
    expect(a.leerCampo("trip", alta.trip_id, "fecha_fin")).toBe("2027-02-25");
    expect(a.contarEntidades("trip_currency")).toBe(2);
    expect(a.entidadExiste("trip_currency", "PYG") && a.entidadExiste("trip_currency", "BRL")).toBe(true);
    expect(a.leerCampo("member", alta.member_id, "apodo")).toBe("Papá");
    expect(a.leerCampo("member", alta.member_id, "color")).toBe("#E8E4F3");
    expect(a.leerCampo("member", alta.member_id, "emoji")).toBe("🧔");
    expect(a.leerCampo("member", alta.member_id, "es_organizador")).toBe(1);
    expect(e.identidad.dispositivo(alta.device_id)).toMatchObject({ nombre: "Poco X7 de Elías", tripId: alta.trip_id, memberId: alta.member_id });
  });

  it("las fechas ausentes y las nulas no son lo mismo en el viaje: la ausente no se escribe y la nula queda nula", async () => {
    const e = entornoApi();
    const sin = await e.crearViaje();
    const nulas = await e.crearViaje({ ...VIAJE, fecha_inicio: null, fecha_fin: null });
    const soloInicio = await e.crearViaje({ ...VIAJE, fecha_inicio: "2027-03-01" });
    const campo = (a: Alta, c: string) => new AlmacenSqlite(e.db, a.trip_id).leerCampo("trip", a.trip_id, c);
    expect([campo(sin, "fecha_inicio"), campo(sin, "fecha_fin")]).toEqual([undefined, undefined]);
    expect([campo(nulas, "fecha_inicio"), campo(nulas, "fecha_fin")]).toEqual([null, null]);
    expect([campo(soloInicio, "fecha_inicio"), campo(soloInicio, "fecha_fin")]).toEqual(["2027-03-01", undefined]);
  });

  it("el token devuelto autentica al organizador", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const { estado } = await e.invitar(org.token, org.trip_id);
    expect(estado).toBe(201);
  });

  it("lo que el servicio rechaza por su contenido (un color que no es un color, una moneda repetida) es 400 formato_invalido", async () => {
    const { app } = entornoApi();
    for (const cambio of [{ color: "rojo" }, { zona_horaria: "" }, { monedas: [] }, { apodo: "" }]) {
      const r = await app.inject({ method: "POST", url: "/v1/trips", payload: { ...VIAJE, ...cambio } });
      expect([JSON.stringify(cambio), r.statusCode, codigoDe(r)]).toEqual([JSON.stringify(cambio), 400, "formato_invalido"]);
    }
  });

  it("un viaje que falla al crearse no deja nada: el siguiente intento correcto funciona", async () => {
    const e = entornoApi();
    await e.app.inject({ method: "POST", url: "/v1/trips", payload: { ...VIAJE, color: "rojo" } });
    expect((await e.crearViaje()).trip_id).toMatch(UUID_V7);
  });
});

describe("POST /v1/join", () => {
  it("un integrante nuevo se une con el código y recibe su token (201)", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    const r = await e.unirse(cuerpo.codigo);
    expect(r.statusCode).toBe(201);
    const ana = r.json<Alta>();
    expect(Object.keys(ana).sort()).toEqual(["device_id", "member_id", "token", "trip_id"]);
    expect(ana.trip_id).toBe(org.trip_id);
    expect(ana.member_id).not.toBe(org.member_id);
    const intento = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(ana.token), payload: {} });
    expect(codigoDe(intento)).toBe("solo_organizador"); // autenticó y no es organizadora
  });

  it("el integrante nuevo queda con su apodo, color y emoji, sin ser organizador, y su dispositivo con el nombre enviado", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org, { nombre_dispositivo: "Celular de Ana", apodo: "Ana", color: "#FFE4E1", emoji: "👩" });
    const a = new AlmacenSqlite(e.db, org.trip_id);
    expect([a.leerCampo("member", ana.member_id, "apodo"), a.leerCampo("member", ana.member_id, "color"), a.leerCampo("member", ana.member_id, "emoji")]).toEqual(["Ana", "#FFE4E1", "👩"]);
    expect(a.leerCampo("member", ana.member_id, "es_organizador")).toBe(0);
    expect(e.identidad.dispositivo(ana.device_id)?.nombre).toBe("Celular de Ana");
  });

  it("el código se acepta como lo escribe una persona (minúsculas, espacios y guiones)", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    const escrito = ` ${cuerpo.codigo.slice(0, 4).toLowerCase()}-${cuerpo.codigo.slice(4).toLowerCase()} `;
    expect((await e.unirse(escrito)).statusCode).toBe(201);
  });

  it("un reemplazo no necesita apodo, color ni emoji, conserva al integrante y revoca al dispositivo viejo", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org);
    const { cuerpo } = await e.invitar(org.token, org.trip_id, { reemplaza_member_id: ana.member_id });
    const r = await e.unirse(cuerpo.codigo, { nombre_dispositivo: "Celular nuevo de Ana" });
    expect(r.statusCode).toBe(201);
    expect(r.json<Alta>().member_id).toBe(ana.member_id);
    const viejo = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(ana.token), payload: {} });
    expect(codigoDe(viejo)).toBe("dispositivo_revocado");
  });

  it("un integrante nuevo sin apodo, color y emoji recibe el mismo codigo_invalido que un código malo", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    const r = await e.unirse(cuerpo.codigo, { nombre_dispositivo: "Celular" });
    expect([r.statusCode, codigoDe(r)]).toEqual([400, "codigo_invalido"]);
    expect((await e.unirse(cuerpo.codigo)).statusCode).toBe(201); // la invitación sigue sirviendo
  });

  it("un código que no es texto llega al servicio y cuenta como intento fallido", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    const ip = { "x-real-ip": "203.0.113.20" };
    for (const raro of [123, null, {}, [], true]) {
      const r = await e.unirse(raro, NUEVO, ip);
      expect([JSON.stringify(raro), r.statusCode, codigoDe(r)]).toEqual([JSON.stringify(raro), 400, "codigo_invalido"]);
    }
    const bloqueado = await e.unirse(cuerpo.codigo, NUEVO, ip); // el 6.º, aunque el código sea bueno
    expect([bloqueado.statusCode, codigoDe(bloqueado)]).toEqual([429, "demasiados_intentos"]);
  });

  it("un pedido sin código o con campos de más es 400 formato_invalido y no cuenta como intento fallido", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    const ip = { "x-real-ip": "203.0.113.21" };
    for (let i = 0; i < 10; i++) {
      const sinCodigo = await e.app.inject({ method: "POST", url: "/v1/join", headers: ip, payload: { nombre_dispositivo: "X" } });
      expect([sinCodigo.statusCode, codigoDe(sinCodigo)]).toEqual([400, "formato_invalido"]);
      const demas = await e.app.inject({ method: "POST", url: "/v1/join", headers: ip, payload: { codigo: cuerpo.codigo, nombre_dispositivo: "X", extra: 1 } });
      expect(demas.statusCode).toBe(400);
    }
    expect((await e.unirse(cuerpo.codigo, NUEVO, ip)).statusCode).toBe(201);
  });

  it("no pide token", async () => {
    const e = entornoApi();
    const r = await e.unirse("ABCDEFGH");
    expect(r.statusCode).not.toBe(401);
  });
});

describe("POST /v1/trips/:trip/invitations", () => {
  it("el organizador recibe un código y cuándo vence (24 horas), con 201", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const { estado, cuerpo } = await e.invitar(org.token, org.trip_id);
    expect(estado).toBe(201);
    expect(Object.keys(cuerpo).sort()).toEqual(["codigo", "vence_en"]);
    expect(cuerpo.codigo).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(cuerpo.vence_en).toBe(e.reloj.ahora + 24 * 3600 * 1000);
  });

  it("reemplaza_member_id puede ser nulo o un integrante del viaje; uno que no existe es 404 y uno que no es texto es 400", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const url = `/v1/trips/${org.trip_id}/invitations`;
    const llamar = (payload: object) => e.app.inject({ method: "POST", url, headers: e.con(org.token), payload });
    expect((await llamar({ reemplaza_member_id: null })).statusCode).toBe(201);
    expect((await llamar({ reemplaza_member_id: org.member_id })).statusCode).toBe(201);
    const noExiste = await llamar({ reemplaza_member_id: "no-existe" });
    expect([noExiste.statusCode, codigoDe(noExiste)]).toEqual([404, "no_existe"]);
    expect((await llamar({ reemplaza_member_id: 5 })).statusCode).toBe(400);
    expect((await llamar({ otro: 1 })).statusCode).toBe(400);
  });

  it("un dispositivo que no es del organizador es 403", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org);
    expect((await e.invitar(ana.token, org.trip_id)).estado).toBe(403);
  });

  it("el viaje del camino debe ser el del dispositivo: otro viaje, uno inexistente o uno con otro formato son 404 (no revela si existe)", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const otro = await e.crearViaje();
    for (const trip of [otro.trip_id, "no-existe", "x".repeat(99)]) {
      const r = await e.invitar(org.token, trip);
      expect([trip.slice(0, 20), r.estado]).toEqual([trip.slice(0, 20), 404]);
    }
  });

  it("un parámetro de ruta larguísimo o una URL mal codificada salen con la misma forma de error, no con la de Fastify", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    for (const url of [`/v1/trips/${"x".repeat(300)}/invitations`, "/v1/trips/%E0%A4%A/invitations", "/v1/trips/%/invitations"]) {
      const r = await e.app.inject({ method: "POST", url, headers: e.con(org.token), payload: {} });
      expect([url.slice(0, 30), r.statusCode, Object.keys(r.json())]).toEqual([url.slice(0, 30), 400, ["error"]]);
      expect(codigoDe(r)).toBe("formato_invalido");
    }
  });
});

describe("POST /v1/trips/:trip/devices/:device/revoke", () => {
  const revocar = (e: ReturnType<typeof entornoApi>, token: string, trip: string, device: string) =>
    e.app.inject({ method: "POST", url: `/v1/trips/${trip}/devices/${device}/revoke`, headers: e.con(token) });

  it("el organizador revoca otro dispositivo del viaje: 204 sin cuerpo, y desde entonces ese token da 401 dispositivo_revocado", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org);
    const r = await revocar(e, org.token, org.trip_id, ana.device_id);
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe("");
    const despues = await e.invitar(ana.token, org.trip_id);
    expect(despues.estado).toBe(401);
  });

  it("revocar uno ya revocado también es 204", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org);
    await revocar(e, org.token, org.trip_id, ana.device_id);
    expect((await revocar(e, org.token, org.trip_id, ana.device_id)).statusCode).toBe(204);
  });

  it("un dispositivo de otro viaje o inexistente es 404, y un dispositivo que no es del organizador es 403", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const otro = await e.crearViaje();
    const ana = await e.sumar(org);
    expect((await revocar(e, org.token, org.trip_id, otro.device_id)).statusCode).toBe(404);
    expect((await revocar(e, org.token, org.trip_id, "no-existe")).statusCode).toBe(404);
    expect((await revocar(e, org.token, otro.trip_id, ana.device_id)).statusCode).toBe(404); // el viaje del camino no es el suyo
    expect((await revocar(e, ana.token, org.trip_id, org.device_id)).statusCode).toBe(403);
    expect((await e.invitar(otro.token, otro.trip_id)).estado).toBe(201); // el del otro viaje sigue activo
  });

  it("el organizador puede revocar su propio dispositivo", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    expect((await revocar(e, org.token, org.trip_id, org.device_id)).statusCode).toBe(204);
    expect((await e.invitar(org.token, org.trip_id)).estado).toBe(401);
  });
});
