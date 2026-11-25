import { describe, expect, it } from "vitest";
import { AHORA, entornoApi, type Alta } from "../ayudas/entornoApi.js";

const marca = (a: Alta, n: number): string => `${(AHORA - 5000 + n).toString(16).padStart(13, "0")}-${n.toString(16).padStart(4, "0")}-${a.device_id}`;
const categoria = (a: Alta, n: number, id = `018f3a6e-7000-7000-8000-${String(n).padStart(12, "0")}`) => ({
  op_id: `018f3a6e-9000-7000-8000-${String(n).padStart(12, "0")}`,
  type: "category.create",
  entity_type: "category",
  entity_id: id,
  hlc: marca(a, n),
  payload: { nombre: `Cat ${n}`, color: "#E8E4F3", emoji: "🛣️" },
  schema_version: 1,
});

async function conViaje() {
  const e = entornoApi();
  const a = await e.crearViaje();
  const subir = (ops: unknown[], token = a.token, trip = a.trip_id) => e.app.inject({ method: "POST", url: `/v1/trips/${trip}/ops`, headers: e.con(token), payload: { ops } });
  const bajar = (consulta = "", token = a.token, trip = a.trip_id) => e.app.inject({ method: "GET", url: `/v1/trips/${trip}/changes${consulta}`, headers: e.con(token) });
  return { e, a, subir, bajar };
}

describe("POST /v1/trips/:trip/ops", () => {
  it("acepta una operación válida, la numera y un reintento devuelve lo mismo como duplicado", async () => {
    const { a, subir } = await conViaje();
    const op = categoria(a, 1);
    const r1 = await subir([op]);
    expect(r1.statusCode).toBe(200);
    const [x] = r1.json<{ resultados: { op_id: string; estado: string; server_seq: number; hlc: string }[] }>().resultados;
    expect(x).toMatchObject({ op_id: op.op_id, estado: "accepted", hlc: op.hlc });
    const r2 = await subir([op]);
    const [y] = r2.json<{ resultados: { estado: string; server_seq: number }[] }>().resultados;
    expect(y).toMatchObject({ estado: "duplicate", server_seq: x?.server_seq });
  });

  it("cuenta las operaciones por resultado: aceptadas, duplicadas y rechazadas con su razón", async () => {
    const { e, a, subir } = await conViaje();
    const op = categoria(a, 1);
    await subir([op, categoria(a, 3), { ...categoria(a, 2), type: "no.existe" }]);
    await subir([op]);
    expect(e.contador("ops", { resultado: "aceptada" })).toBe(2);
    expect(e.contador("ops", { resultado: "duplicada" })).toBe(1);
    expect(e.contador("ops", { resultado: "rechazada", razon: "formato" })).toBe(1);
  });

  it("una operación mala se rechaza con su razón sin frenar a las demás", async () => {
    const { a, subir } = await conViaje();
    const r = await subir([{ ...categoria(a, 1), type: "no.existe" }, categoria(a, 2), 7]);
    expect(r.statusCode).toBe(200);
    const { resultados } = r.json<{ resultados: { estado: string; razon?: string }[] }>();
    expect(resultados.map((x) => x.estado)).toEqual(["rejected", "accepted", "rejected"]);
    expect(resultados[0]?.razon).toBe("formato");
  });

  it("la versión de formato es obligatoria: sin ella, como texto o una que el servidor no entiende, se rechaza sola", async () => {
    const { a, subir } = await conViaje();
    const { schema_version: _v, ...sinVersion } = categoria(a, 1);
    const r = await subir([sinVersion, { ...categoria(a, 2), schema_version: 2 }, { ...categoria(a, 3), schema_version: "1" }, categoria(a, 4)]);
    const { resultados } = r.json<{ resultados: { estado: string; razon?: string }[] }>();
    expect(resultados.map((x) => [x.estado, x.razon])).toEqual([
      ["rejected", "formato"],
      ["rejected", "formato"],
      ["rejected", "formato"],
      ["accepted", undefined],
    ]);
  });

  it("el dispositivo y el integrante de cada operación salen del token: lo que mande la app en esos campos no cuenta", async () => {
    const { e, a, subir, bajar } = await conViaje();
    const b = await e.sumar(a);
    const ajena = { ...categoria(a, 1), device_id: b.device_id, member_id: b.member_id };
    expect((await subir([ajena])).json<{ resultados: { estado: string }[] }>().resultados[0]?.estado).toBe("accepted");
    const ops = (await bajar()).json<{ ops: { op_id: string; device_id: string; member_id: string; schema_version: number }[] }>().ops;
    expect(ops.find((o) => o.op_id === ajena.op_id)).toMatchObject({ device_id: a.device_id, member_id: a.member_id, schema_version: 1 });
  });

  it("la bajada devuelve la versión guardada de cada operación (no una fija)", async () => {
    const { e, a, subir, bajar } = await conViaje();
    const op = categoria(a, 1);
    await subir([op]);
    e.db.prepare("UPDATE op SET schema_version = 2 WHERE op_id = ?").run(op.op_id);
    const ops = (await bajar()).json<{ ops: { op_id: string; schema_version: number }[] }>().ops;
    expect(ops.find((o) => o.op_id === op.op_id)?.schema_version).toBe(2);
  });

  it("cada operación guarda la hora del servidor en que se aceptó, y un duplicado no la cambia", async () => {
    const { e, a, subir } = await conViaje();
    const op = categoria(a, 1);
    e.reloj.ahora += 7000;
    await subir([op]);
    const hora = () => (e.db.prepare("SELECT aceptada_en AS h FROM op WHERE op_id = ?").get(op.op_id) as { h: number }).h;
    const aceptada = e.reloj.ahora;
    expect(hora()).toBe(aceptada);
    e.reloj.ahora += 5000;
    await subir([op]);
    expect(hora()).toBe(aceptada);
  });

  it("las operaciones que genera el servidor al crear el viaje y al unirse llevan a su dispositivo e integrante", async () => {
    const { e, a, bajar } = await conViaje();
    const b = await e.sumar(a);
    const ops = (await bajar()).json<{ ops: { type: string; entity_id: string; device_id: string; member_id: string; schema_version: number }[] }>().ops;
    expect(ops.filter((o) => o.type === "trip.create")).toEqual([expect.objectContaining({ device_id: a.device_id, member_id: a.member_id, schema_version: 1 })]);
    expect(ops.filter((o) => o.type === "member.join").map((o) => [o.entity_id, o.device_id, o.member_id])).toEqual([
      [a.member_id, a.device_id, a.member_id],
      [b.member_id, b.device_id, b.member_id],
    ]);
  });

  it("una operación con la marca de otro dispositivo se rechaza", async () => {
    const { e, a, subir } = await conViaje();
    const b = await e.sumar(a);
    const r = await subir([categoria(b, 1)]);
    expect(r.json<{ resultados: { estado: string; razon?: string }[] }>().resultados[0]).toMatchObject({ estado: "rejected", razon: "formato" });
  });

  it("sin token es 401, con el token de otro viaje es 404 y nada se guarda", async () => {
    const { e, a, subir, bajar } = await conViaje();
    const otro = await e.crearViaje();
    expect((await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/ops`, payload: { ops: [categoria(a, 1)] } })).statusCode).toBe(401);
    const r = await subir([categoria(a, 1)], otro.token);
    expect(r.statusCode).toBe(404);
    const cambios = (await bajar()).json<{ ops: { type: string }[] }>().ops;
    expect(cambios.some((o) => o.type === "category.create")).toBe(false);
  });

  it("un lote vacío, de más de 100 o con campos de más es 400 formato_invalido", async () => {
    const { a, subir, e } = await conViaje();
    expect((await subir([])).statusCode).toBe(400);
    const grande = await subir(Array.from({ length: 101 }, (_, i) => categoria(a, i + 1)));
    expect(grande.statusCode).toBe(400);
    expect(grande.json<{ error: { codigo: string } }>().error.codigo).toBe("formato_invalido");
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/ops`, headers: e.con(a.token), payload: { ops: [categoria(a, 1)], extra: 1 } });
    expect(r.statusCode).toBe(400);
  });

  it("acepta un lote de 100 operaciones aunque pase de los 16 KB generales y rechaza uno de más de 512 KB", async () => {
    const { a, subir, e } = await conViaje();
    const cien = Array.from({ length: 100 }, (_, i) => categoria(a, i + 1));
    expect(JSON.stringify({ ops: cien }).length).toBeGreaterThan(16 * 1024);
    const r = await subir(cien);
    expect(r.statusCode).toBe(200);
    expect(r.json<{ resultados: { estado: string }[] }>().resultados.every((x) => x.estado === "accepted")).toBe(true);
    const enorme = await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/ops`, headers: e.con(a.token), payload: { ops: [{ ...categoria(a, 1), payload: { nombre: "x".repeat(600 * 1024) } }] } });
    expect(enorme.statusCode).toBe(400);
  });
});

describe("GET /v1/trips/:trip/changes y /head", () => {
  it("baja desde el principio las operaciones del alta del viaje con su secuencia y sin huecos", async () => {
    const { bajar } = await conViaje();
    const c = (await bajar()).json<{ ops: { server_seq: number; type: string; redacted: boolean }[]; next: number; hay_mas: boolean; head_seq: number; ahora: number }>();
    expect(c.ops.length).toBeGreaterThan(0);
    expect(c.ops.map((o) => o.server_seq)).toEqual(c.ops.map((_, i) => i + 1));
    expect(c.ops[0]?.type).toBe("trip.create");
    expect([c.next, c.hay_mas, c.head_seq, c.ahora]).toEqual([c.ops.length, false, c.ops.length, AHORA]);
  });

  it("pagina con limit y after, y otro dispositivo ve lo que subió el primero", async () => {
    const { e, a, subir, bajar } = await conViaje();
    await subir([categoria(a, 1), categoria(a, 2), categoria(a, 3)]);
    const b = await e.sumar(a);
    const total = (await bajar("", b.token)).json<{ head_seq: number }>().head_seq;
    const p1 = (await bajar("?after=0&limit=2", b.token)).json<{ ops: unknown[]; next: number; hay_mas: boolean }>();
    expect([p1.ops.length, p1.next, p1.hay_mas]).toEqual([2, 2, true]);
    const resto = (await bajar(`?after=${total - 1}`, b.token)).json<{ ops: { server_seq: number }[]; hay_mas: boolean }>();
    expect([resto.ops.map((o) => o.server_seq), resto.hay_mas]).toEqual([[total], false]);
  });

  it("sin limit baja hasta 200 de una vez, una redactada sale sin payload y head_seq no es el next de una página corta", async () => {
    const { e, a, subir, bajar } = await conViaje();
    for (let i = 0; i < 2; i++) await subir(Array.from({ length: 100 }, (_, k) => categoria(a, i * 100 + k + 1)));
    const todo = (await bajar()).json<{ ops: unknown[]; hay_mas: boolean; head_seq: number }>();
    expect(todo.ops).toHaveLength(200);
    expect(todo.hay_mas).toBe(true);
    const corta = (await bajar("?limit=2")).json<{ next: number; head_seq: number }>();
    expect(corta.next).toBe(2);
    expect(corta.head_seq).toBe(todo.head_seq);
    e.db.prepare("UPDATE op SET payload = NULL, redactada = 1 WHERE op_id = ?").run(categoria(a, 1).op_id);
    const ops = (await bajar("?after=2&limit=200")).json<{ ops: { op_id: string; payload: unknown; redacted: boolean; server_seq: number }[] }>().ops;
    expect(ops.find((o) => o.op_id === categoria(a, 1).op_id)).toMatchObject({ payload: null, redacted: true });
    expect(ops.find((o) => o.op_id === categoria(a, 2).op_id)).toMatchObject({ payload: { nombre: "Cat 2" }, redacted: false });
  });

  it("los parámetros mal formados son 400 y un viaje ajeno es 404", async () => {
    const { e, bajar } = await conViaje();
    for (const q of ["?after=-1", "?after=abc", "?limit=1.5", "?after=1&x=2", "?after=1234567890123456"]) expect((await bajar(q)).statusCode, q).toBe(400);
    const otro = await e.crearViaje();
    expect((await bajar("", otro.token)).statusCode).toBe(404);
  });

  it("head da la cabeza y la hora del servidor, y exige token del viaje", async () => {
    const { e, a, subir } = await conViaje();
    const antes = (await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head`, headers: e.con(a.token) })).json<{ head_seq: number }>().head_seq;
    await subir([categoria(a, 1)]);
    const r = await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head`, headers: e.con(a.token) });
    expect(r.json()).toEqual({ head_seq: antes + 1, ahora: AHORA });
    expect((await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head` })).statusCode).toBe(401);
    const otro = await e.crearViaje();
    expect((await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head`, headers: e.con(otro.token) })).statusCode).toBe(404);
  });

  it("un dispositivo revocado no puede subir ni bajar", async () => {
    const { e, a, subir, bajar } = await conViaje();
    const b = await e.sumar(a);
    await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/devices/${b.device_id}/revoke`, headers: e.con(a.token) });
    expect((await bajar("", b.token)).statusCode).toBe(401);
    expect((await subir([categoria(b, 1)], b.token)).statusCode).toBe(401);
  });
});
