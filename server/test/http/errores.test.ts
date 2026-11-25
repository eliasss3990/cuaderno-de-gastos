import { describe, expect, it } from "vitest";
import type { ServicioDeIdentidad } from "../../src/dominio/identidad/servicioIdentidad.js";
import { entornoApi, NUEVO, VIAJE } from "../ayudas/entornoApi.js";

const cuerpoDe = (r: { json: () => unknown }) => r.json() as { error: { codigo: string; mensaje: string } };

describe("cada código de error del servicio sale con su estado HTTP", () => {
  it("formato_invalido es 400", async () => {
    const { app } = entornoApi();
    const r = await app.inject({ method: "POST", url: "/v1/trips", payload: { ...VIAJE, nombre_dispositivo: "   " } });
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([400, "formato_invalido"]);
  });

  it("no_autorizado es 401", async () => {
    const { app } = entornoApi();
    const r = await app.inject({ method: "POST", url: "/v1/trips/x/invitations", payload: {} });
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([401, "no_autorizado"]);
  });

  it("dispositivo_revocado es 401", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org);
    await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/devices/${ana.device_id}/revoke`, headers: e.con(org.token) });
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(ana.token), payload: {} });
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([401, "dispositivo_revocado"]);
  });

  it("solo_organizador es 403", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org);
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(ana.token), payload: {} });
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([403, "solo_organizador"]);
  });

  it("no_existe es 404", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const r = await e.app.inject({ method: "POST", url: "/v1/trips/otro/invitations", headers: e.con(org.token), payload: {} });
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([404, "no_existe"]);
  });

  it("codigo_invalido es 400", async () => {
    const { unirse } = entornoApi();
    const r = await unirse("ABCDEFGH");
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([400, "codigo_invalido"]);
  });

  it("viaje_completo es 409", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    for (let i = 1; i <= 3; i++) await e.sumar(org, { ...NUEVO, nombre_dispositivo: `Celular ${i}`, apodo: `Ana${i}` });
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    const r = await e.unirse(cuerpo.codigo);
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([409, "viaje_completo"]);
  });

  it("demasiadas_invitaciones es 409 desde la 6.ª invitación pendiente del viaje, con un mensaje que explica qué hacer", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    for (let i = 1; i <= 5; i++) expect((await e.invitar(org.token, org.trip_id)).estado).toBe(201);
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(org.token), payload: {} });
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([409, "demasiadas_invitaciones"]);
    expect(cuerpoDe(r).error.mensaje).toBe("ya hay 5 invitaciones sin usar; esperá a que se usen o venzan");
  });

  it("una invitación usada libera su lugar", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const codigos: string[] = [];
    for (let i = 1; i <= 5; i++) codigos.push((await e.invitar(org.token, org.trip_id)).cuerpo.codigo);
    expect((await e.unirse(codigos[0])).statusCode).toBe(201);
    expect((await e.invitar(org.token, org.trip_id)).estado).toBe(201);
    expect((await e.invitar(org.token, org.trip_id)).estado).toBe(409);
  });

  it("una invitación vencida libera su lugar justo al vencer, no antes", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    for (let i = 1; i <= 5; i++) await e.invitar(org.token, org.trip_id);
    e.reloj.ahora += 24 * 60 * 60 * 1000 - 1;
    expect((await e.invitar(org.token, org.trip_id)).estado).toBe(409);
    e.reloj.ahora += 1;
    expect((await e.invitar(org.token, org.trip_id)).estado).toBe(201);
  });

  it("las invitaciones de rescate del administrador no ocupan lugar del organizador ni se frenan por el tope", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    for (let i = 1; i <= 4; i++) await e.invitar(org.token, org.trip_id);
    for (let i = 1; i <= 3; i++) expect(() => e.servicio.invitarComoAdministrador(org.trip_id, null)).not.toThrow();
    expect((await e.invitar(org.token, org.trip_id)).estado).toBe(201); // 4 propias + 3 de rescate: todavía hay lugar
    expect((await e.invitar(org.token, org.trip_id)).estado).toBe(409);
    expect(() => e.servicio.invitarComoAdministrador(org.trip_id, null)).not.toThrow();
  });

  it("demasiados_intentos es 429 desde el 6.º intento fallido; los 5 primeros devuelven su error normal", async () => {
    const e = entornoApi();
    const cabeceras = { "x-real-ip": "203.0.113.9" };
    for (let i = 0; i < 5; i++) expect((await e.unirse("ABCDEFGH", NUEVO, cabeceras)).statusCode).toBe(400);
    const r = await e.unirse("ABCDEFGH", NUEVO, cabeceras);
    expect([r.statusCode, cuerpoDe(r).error.codigo]).toEqual([429, "demasiados_intentos"]);
  });

  it("el mensaje es el del servicio: dice qué pasó sin revelar de más", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    const ana = await e.sumar(org);
    const mensaje = async (r: Promise<{ json: () => unknown }>) => cuerpoDe(await r).error.mensaje;
    expect(await mensaje(e.unirse("ABCDEFGH"))).toBe("código inválido");
    expect(await mensaje(e.app.inject({ method: "POST", url: "/v1/trips/x/invitations", payload: {} }))).toBe("token inválido");
    expect(await mensaje(e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(ana.token), payload: {} }))).toBe("solo el organizador puede hacerlo");
    expect(await mensaje(e.app.inject({ method: "POST", url: "/v1/trips/otro/invitations", headers: e.con(org.token), payload: {} }))).toBe("el viaje no existe");
    expect(await mensaje(e.app.inject({ method: "POST", url: "/v1/trips", payload: { ...VIAJE, nombre_dispositivo: "   " } }))).toMatch(/^nombreDispositivo: /);
    await e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/devices/${ana.device_id}/revoke`, headers: e.con(org.token) });
    expect(await mensaje(e.app.inject({ method: "POST", url: `/v1/trips/${org.trip_id}/invitations`, headers: e.con(ana.token), payload: {} }))).toBe("el dispositivo fue revocado");
  });

  it("el mensaje de viaje_completo y el de demasiados_intentos también son los del servicio", async () => {
    const e = entornoApi();
    const org = await e.crearViaje();
    for (let i = 1; i <= 3; i++) await e.sumar(org, { ...NUEVO, nombre_dispositivo: `Celular ${i}`, apodo: `Ana${i}` });
    const { cuerpo } = await e.invitar(org.token, org.trip_id);
    expect(cuerpoDe(await e.unirse(cuerpo.codigo)).error.mensaje).toBe("el viaje ya tiene 4 dispositivos activos");
    const ip = { "x-real-ip": "203.0.113.50" };
    for (let i = 0; i < 5; i++) await e.unirse("ABCDEFGH", NUEVO, ip);
    expect(cuerpoDe(await e.unirse("ABCDEFGH", NUEVO, ip)).error.mensaje).toBe("demasiados intentos fallidos: probá de nuevo más tarde");
  });

  it("el cuerpo de todo error tiene exactamente la forma {error:{codigo,mensaje}}", async () => {
    const { app, unirse } = entornoApi();
    for (const r of [await unirse("ABCDEFGH"), await app.inject({ method: "POST", url: "/v1/trips/x/invitations", payload: {} }), await app.inject({ method: "GET", url: "/nada" })]) {
      const c = r.json() as Record<string, Record<string, unknown>>;
      expect(Object.keys(c)).toEqual(["error"]);
      expect(Object.keys(c.error!).sort()).toEqual(["codigo", "mensaje"]);
      expect(typeof c.error!.mensaje).toBe("string");
      expect((c.error!.mensaje as string).length).toBeGreaterThan(0);
    }
  });
});

describe("el resto de los errores", () => {
  it("una ruta que no existe es 404 no_existe", async () => {
    const { app } = entornoApi();
    for (const url of ["/nada", "/v1/nada", "/v1/trips/x/ops"]) {
      const r = await app.inject({ method: "GET", url });
      expect([url, r.statusCode, cuerpoDe(r).error.codigo]).toEqual([url, 404, "no_existe"]);
    }
  });

  it("un error inesperado es 500 error_interno sin detalles, y queda en el log con lo reconocible oculto", async () => {
    const roto = {
      crearViaje: () => {
        throw new Error("boom token=SECRETO-XYZ");
      },
      autenticar: () => {
        throw new RangeError("falla de programación");
      },
    } as unknown as ServicioDeIdentidad;
    const e = entornoApi({ servicio: roto });
    const r = await e.app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: { codigo: "error_interno", mensaje: "error interno del servidor" } });
    expect(r.body).not.toContain("boom");
    const entrada = e.registro.entradas.find((x) => x.evento === "error_interno");
    expect(entrada?.nivel).toBe("error");
    expect((entrada?.campos.err as { message: string }).message).toBe("boom token=[oculto]");
    expect(JSON.stringify(e.registro.entradas)).not.toContain("SECRETO-XYZ");
    // un error de programación (RangeError) del servicio tampoco se muestra
    const r2 = await e.app.inject({ method: "POST", url: "/v1/trips/x/invitations", headers: { authorization: "Bearer abc" }, payload: {} });
    expect([r2.statusCode, cuerpoDe(r2).error.codigo]).toEqual([500, "error_interno"]);
    expect(r2.body).not.toContain("programación");
  });

  it("un error de Fastify con estado 4xx es 400; con 500 o más, o con un estado que no es un número 4xx, es 500", async () => {
    const lanza = (estado: unknown) => ({ crearViaje: () => { throw Object.assign(new Error("x"), { statusCode: estado }); } }) as unknown as ServicioDeIdentidad;
    const resultado = async (estado: unknown) => {
      const e = entornoApi({ servicio: lanza(estado) });
      const r = await e.app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE });
      return [r.statusCode, cuerpoDe(r).error.codigo];
    };
    expect(await resultado(400)).toEqual([400, "formato_invalido"]);
    expect(await resultado(499)).toEqual([400, "formato_invalido"]);
    expect(await resultado(404)).toEqual([400, "formato_invalido"]);
    for (const estado of [500, 503, 399, 200, "404", null, undefined, NaN]) expect([String(estado), ...(await resultado(estado))]).toEqual([String(estado), 500, "error_interno"]);
  });

  it("el log de un error inesperado lleva el req_id del pedido", async () => {
    const roto = { crearViaje: () => { throw new Error("boom"); } } as unknown as ServicioDeIdentidad;
    const e = entornoApi({ servicio: roto });
    await e.app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE });
    const entrada = e.registro.entradas.find((x) => x.evento === "error_interno");
    expect(entrada?.campos.req_id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("un JSON mal formado o un cuerpo vacío son 400 formato_invalido; otro tipo de contenido es 415 y un cuerpo enorme 413", async () => {
    const { app } = entornoApi();
    const j = { "content-type": "application/json" };
    const casos: [string, { payload?: string; headers?: Record<string, string> }][] = [
      ["JSON mal formado", { payload: "{no es json", headers: j }],
      ["cuerpo vacío", { payload: "", headers: j }],
      // text/plain lo lee Fastify como texto: el esquema lo rechaza
      ["texto plano", { payload: "hola", headers: { "content-type": "text/plain" } }],
    ];
    for (const [nombre, req] of casos) {
      const r = await app.inject({ method: "POST", url: "/v1/trips", ...req });
      expect([nombre, r.statusCode, cuerpoDe(r).error.codigo]).toEqual([nombre, 400, "formato_invalido"]);
    }
    const otros: [string, { payload: string; headers: Record<string, string> }, number, string][] = [
      ["tipo no admitido", { payload: "<a/>", headers: { "content-type": "application/xml" } }, 415, "tipo_de_contenido_no_admitido"],
      ["cuerpo de más de 16 KB", { payload: JSON.stringify({ ...VIAJE, nombre: "x".repeat(17 * 1024) }), headers: j }, 413, "cuerpo_demasiado_grande"],
    ];
    for (const [nombre, req, estado, codigo] of otros) {
      const r = await app.inject({ method: "POST", url: "/v1/trips", ...req });
      expect([nombre, r.statusCode, cuerpoDe(r).error.codigo]).toEqual([nombre, estado, codigo]);
    }
  });

  it("los esquemas no convierten tipos ni borran campos: un número por un texto, un texto por un entero o un campo de más son 400", async () => {
    const { app } = entornoApi();
    const malos: Record<string, object> = {
      "número por texto": { ...VIAJE, nombre: 123 },
      "texto por entero": { ...VIAJE, monedas: [{ codigo: "BRL", decimales: "2", simbolo: "R$" }] },
      "campo de más": { ...VIAJE, secreto: "x" },
      "campo de más en una moneda": { ...VIAJE, monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$", otro: 1 }] },
      "falta un campo": Object.fromEntries(Object.entries(VIAJE).filter(([k]) => k !== "emoji")),
      "nulo por texto": { ...VIAJE, apodo: null },
      "decimal por entero": { ...VIAJE, monedas: [{ codigo: "BRL", decimales: 2.5, simbolo: "R$" }] },
      "objeto por lista": { ...VIAJE, monedas: { codigo: "BRL" } },
    };
    for (const [nombre, payload] of Object.entries(malos)) {
      const r = await app.inject({ method: "POST", url: "/v1/trips", payload });
      expect([nombre, r.statusCode, cuerpoDe(r).error.codigo]).toEqual([nombre, 400, "formato_invalido"]);
    }
  });

  it("lo que no es una validación de esquema (JSON roto, cuerpo demasiado grande) tiene el mensaje genérico; el límite es de 16 KB", async () => {
    const { app } = entornoApi();
    const mensaje = async (payload: string, tipo = "application/json") => cuerpoDe(await app.inject({ method: "POST", url: "/v1/trips", payload, headers: { "content-type": tipo } })).error.mensaje;
    expect(await mensaje("{roto")).toBe("el pedido no es válido");
    expect(await mensaje("<a/>", "application/xml")).toBe("el cuerpo debe ser JSON");
    const con = (kb: number) => JSON.stringify({ ...VIAJE, nombre: "x".repeat(kb * 1024) });
    expect(await mensaje(con(12))).not.toBe("el pedido no es válido"); // entra en el límite: lo juzga el servicio
    expect(await mensaje(con(20))).toBe("el pedido es demasiado grande"); // lo corta el límite
  });

  it("cada exigencia del esquema la dice el esquema (no solo el servicio): campos obligatorios, enteros y campos de más", async () => {
    const { app } = entornoApi();
    const mensaje = async (payload: object) => cuerpoDe(await app.inject({ method: "POST", url: "/v1/trips", payload })).error.mensaje;
    for (const campo of ["nombre", "zona_horaria", "monedas", "nombre_dispositivo", "apodo", "color", "emoji"]) {
      const sin = Object.fromEntries(Object.entries(VIAJE).filter(([k]) => k !== campo));
      expect(await mensaje(sin)).toBe(`cuerpo: must have required property '${campo}'`);
    }
    expect(await mensaje({ ...VIAJE, monedas: [{ codigo: "BRL", simbolo: "R$" }] })).toBe("monedas.0: must have required property 'decimales'");
    expect(await mensaje({ ...VIAJE, monedas: [{ codigo: "BRL", decimales: 2.5, simbolo: "R$" }] })).toBe("monedas.0.decimales: must be integer");
    expect(await mensaje({ ...VIAJE, monedas: [{ codigo: "BRL", decimales: 2, simbolo: "R$", otro: 1 }] })).toBe("monedas.0: must NOT have additional properties");
    expect(await mensaje({ ...VIAJE, extra: 1 })).toBe("cuerpo: must NOT have additional properties");
    const unirse = (payload: object) => app.inject({ method: "POST", url: "/v1/join", payload });
    expect(cuerpoDe(await unirse({ codigo: "ABCDEFGH" })).error.mensaje).toBe("cuerpo: must have required property 'nombre_dispositivo'");
    expect(cuerpoDe(await unirse({ nombre_dispositivo: "x" })).error.mensaje).toBe("cuerpo: must have required property 'codigo'");
    expect(cuerpoDe(await unirse({ codigo: "A", nombre_dispositivo: "x", otro: 1 })).error.mensaje).toBe("cuerpo: must NOT have additional properties");
  });

  it("el mensaje de una validación dice qué campo falló pero nunca repite el valor del pedido", async () => {
    const { app } = entornoApi();
    const tipo = await app.inject({ method: "POST", url: "/v1/trips", payload: { ...VIAJE, nombre: 123456789 } });
    expect(cuerpoDe(tipo).error.mensaje).toBe("nombre: must be string");
    const demas = await app.inject({ method: "POST", url: "/v1/trips", payload: { ...VIAJE, VALOR_SECRETO_ABC: "VALOR-SECRETO" } });
    expect(demas.body).not.toContain("VALOR");
    const falta = await app.inject({ method: "POST", url: "/v1/trips", payload: {} });
    expect(cuerpoDe(falta).error.mensaje).toMatch(/^cuerpo: /);
    const anidado = await app.inject({ method: "POST", url: "/v1/trips", payload: { ...VIAJE, monedas: [{ codigo: 5, decimales: 2, simbolo: "R$" }] } });
    expect(cuerpoDe(anidado).error.mensaje).toBe("monedas.0.codigo: must be string");
  });
});
