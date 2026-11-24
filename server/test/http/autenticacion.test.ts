import { describe, expect, it } from "vitest";
import { construirApi } from "../../src/api.js";
import { entornoApi, VIAJE } from "../ayudas/entornoApi.js";

const codigoDe = (r: { json: () => unknown }) => (r.json() as { error: { codigo: string } }).error.codigo;

describe("armar la API", () => {
  it("no emite avisos de deprecación de Fastify (cuando una opción se elimine, que falle acá y no al actualizar)", async () => {
    const avisos: string[] = [];
    const alAvisar = (a: Error) => avisos.push(`${a.name}: ${a.message}`);
    process.on("warning", alAvisar);
    try {
      const e = entornoApi({ versionMinima: "0.1.0" });
      await e.app.ready();
      await e.app.inject({ method: "GET", url: "/healthz" });
      await new Promise((resolver) => setImmediate(resolver));
    } finally {
      process.off("warning", alAvisar);
    }
    expect(avisos).toEqual([]);
  });
});

describe("el token de dispositivo (Authorization: Bearer)", () => {
  it("sin cabecera, con otro esquema, sin token, con espacios de más o con un token que no existe es 401 no_autorizado", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const url = `/v1/trips/${org.trip_id}/invitations`;
    const casos = [undefined, "Basic abc", "Foo Bearer " + org.token, "Token Bearer " + org.token, "Bearer", "Bearer ", "Bearer   ", "Token abc", `Bearer ${org.token} extra`, "Bearer " + "x".repeat(43), `Bearer${org.token}`, "", org.token];
    for (const autorizacion of casos) {
      const headers = autorizacion === undefined ? {} : { authorization: autorizacion };
      const r = await e.app.inject({ method: "POST", url, headers, payload: {} });
      expect([autorizacion, r.statusCode, codigoDe(r)]).toEqual([autorizacion, 401, "no_autorizado"]);
    }
  });

  it("el esquema Bearer no distingue mayúsculas y admite espacios o tabulaciones antes y después del token", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    for (const autorizacion of [`bearer ${org.token}`, `BEARER ${org.token}`, `Bearer   ${org.token}`, `Bearer\t${org.token}`, `Bearer ${org.token}  `]) {
      const r = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: { authorization: autorizacion }, payload: {} });
      expect([autorizacion, r.statusCode]).toEqual([autorizacion, 201]);
    }
  });

  it("un token revocado es 401 dispositivo_revocado (distinto de uno que no existe)", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/devices/${org.device_id}/revoke`, headers: e.con(org.token) });
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(org.token), payload: {} });
    expect([r.statusCode, codigoDe(r)]).toEqual([401, "dispositivo_revocado"]);
  });

  it("la autenticación va antes que leer el cuerpo: sin token un JSON roto es 401 y con token es 400", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const url = `/v1/trips/${org.trip_id}/invitations`;
    const roto = { payload: "{roto", headers: { "content-type": "application/json" } };
    const sin = await e.app.inject({ method: "POST", url, ...roto });
    expect(sin.statusCode).toBe(401);
    const con = await e.app.inject({ method: "POST", url, ...roto, headers: { ...roto.headers, ...e.con(org.token) } });
    expect(con.statusCode).toBe(400);
    const demas = await e.app.inject({ method: "POST", url, headers: e.con("x"), payload: { otro: 1 } });
    expect(demas.statusCode).toBe(401); // y un cuerpo inválido tampoco se valida antes de autenticar
  });

  it("las rutas de alta (crear viaje y unirse) no piden token", async () => {
    const e = entornoApi();
    expect((await e.app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE })).statusCode).toBe(201);
    expect((await e.unirse("ABCDEFGH")).statusCode).toBe(400);
  });
});

describe("lo que el celular informa en cada pedido (X-Ultimo-Seq y X-Pendientes)", () => {
  const visto = (e: ReturnType<typeof entornoApi>, id: string) => {
    const d = e.identidad.dispositivo(id);
    return d === null ? null : { ultimoSeq: d.ultimoSeqVisto, pendientes: d.pendientes, vistoEn: d.ultimoVistoEn };
  };

  it("se anotan junto con la hora del servidor cuando los dos son números", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    e.reloj.ahora += 5000;
    await e.invitar(org.token, org.trip_id); // sin cabeceras: nada
    expect(visto(e, org.device_id)).toMatchObject({ ultimoSeq: 0, pendientes: 0 });
    await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(org.token, { "x-ultimo-seq": "42", "x-pendientes": "3" }), payload: {} });
    expect(visto(e, org.device_id)).toEqual({ ultimoSeq: 42, pendientes: 3, vistoEn: e.reloj.ahora });
  });

  it("si falta uno o alguno no es un entero no negativo de hasta 15 cifras, no se anota nada y el pedido sigue", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const malos: Record<string, string>[] = [
      { "x-ultimo-seq": "7" },
      { "x-pendientes": "7" },
      { "x-ultimo-seq": "abc", "x-pendientes": "1" },
      { "x-ultimo-seq": "-1", "x-pendientes": "1" },
      { "x-ultimo-seq": "1.5", "x-pendientes": "1" },
      { "x-ultimo-seq": "1e3", "x-pendientes": "1" },
      { "x-ultimo-seq": "", "x-pendientes": "1" },
      { "x-ultimo-seq": "1".repeat(16), "x-pendientes": "1" },
      { "x-ultimo-seq": "1", "x-pendientes": " 2" },
    ];
    for (const extra of malos) {
      const r = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(org.token, extra), payload: {} });
      expect([JSON.stringify(extra), r.statusCode]).toEqual([JSON.stringify(extra), 201]);
      expect([JSON.stringify(extra), visto(e, org.device_id)]).toEqual([JSON.stringify(extra), { ultimoSeq: 0, pendientes: 0, vistoEn: null }]);
    }
    const borde = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(org.token, { "x-ultimo-seq": "9".repeat(15), "x-pendientes": "0" }), payload: {} });
    expect(borde.statusCode).toBe(201);
    expect(visto(e, org.device_id)?.ultimoSeq).toBe(999999999999999);
  });
});

describe("la versión mínima de la app (APP_MIN_VERSION)", () => {
  const llamar = (e: ReturnType<typeof entornoApi>, version?: string, url = "/v1/trips") =>
    e.app.inject({ method: "POST", url, headers: version === undefined ? {} : { "x-app-version": version }, payload: VIAJE });

  it("una versión menor es 426 app_desactualizada en las rutas /v1, con y sin token", async () => {
    const e = entornoApi({ versionMinima: "0.2.0" });
    const r = await llamar(e, "0.1.9");
    expect([r.statusCode, codigoDe(r)]).toEqual([426, "app_desactualizada"]);
    expect((r.json() as { error: { mensaje: string } }).error.mensaje).toBe("Actualizá la app");
    expect((await llamar(e, "0.1.9", "/v1/trips/x/invitations")).statusCode).toBe(426);
    expect((await llamar(e, "0.1.9-debug")).statusCode).toBe(426);
    expect((await llamar(e, "0")).statusCode).toBe(426);
  });

  it("la versión igual o mayor pasa, también con sufijo o con menos números", async () => {
    const e = entornoApi({ versionMinima: "0.2.0" });
    for (const v of ["0.2.0", "0.2", "0.2.1", "0.2.0-debug", "1", "1.0.0", "0.10.0", "0.2.0.1"]) {
      expect([v, (await llamar(e, v)).statusCode]).toEqual([v, 201]);
    }
  });

  it("sin cabecera o con una que no se entiende, pasa", async () => {
    const e = entornoApi({ versionMinima: "5.0.0" });
    for (const v of [undefined, "", "abc", "1.2.3.4.5", "v1.0"]) expect([v, (await llamar(e, v)).statusCode]).toEqual([v, 201]);
  });

  it("la salud y las rutas que no existen no la exigen", async () => {
    const e = entornoApi({ versionMinima: "9.0.0" });
    const h = { "x-app-version": "0.0.1" };
    expect((await e.app.inject({ method: "GET", url: "/healthz", headers: h })).statusCode).toBe(200);
    expect((await e.app.inject({ method: "GET", url: "/v1/nada", headers: h })).statusCode).toBe(404);
  });

  it("se revisa antes que el token: una app vieja con un token malo recibe 426", async () => {
    const e = entornoApi({ versionMinima: "1.0.0" });
    const r = await e.app.inject({ method: "POST", url: "/v1/trips/x/invitations", headers: { authorization: "Bearer malo", "x-app-version": "0.9.0" }, payload: {} });
    expect(r.statusCode).toBe(426);
  });

  it("sin versión mínima no se exige ninguna, y una que no se entiende falla al armar la API", () => {
    expect(() => entornoApi()).not.toThrow();
    const e = entornoApi();
    for (const mala of ["abc", "", "1.2.3.4.5", "-1"]) {
      expect(() => construirApi({ servicio: e.servicio, sincronizacion: e.sincronizacion, canal: e.canal, registro: e.registro, metricas: e.metricas, versionMinima: mala })).toThrow(RangeError);
    }
  });
});
