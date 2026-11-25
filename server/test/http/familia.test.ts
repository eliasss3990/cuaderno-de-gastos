import { describe, expect, it } from "vitest";
import { AHORA, entornoApi, NUEVO, type Alta } from "../ayudas/entornoApi.js";

interface Fila { device_id: string; member_id: string; nombre: string; ultimo_visto_en: number | null; ultimo_seq_visto: number; pendientes: number; revocado_en: number | null }
interface Familia { dispositivos: Fila[]; head_seq: number; ahora: number }

async function entorno() {
  const e = entornoApi();
  const a = await e.crearViaje();
  const pedir = async (token: string, extra: Record<string, string> = {}, trip = a.trip_id) => e.app.inject({ method: "GET", url: `/v1/trips/${trip}/familia`, headers: e.con(token, extra) });
  return { e, a, pedir };
}

describe("GET /v1/trips/:trip/familia", () => {
  it("lista a los dispositivos del viaje, del más antiguo al más nuevo, con exactamente los campos del contrato", async () => {
    const { e, a, pedir } = await entorno();
    e.reloj.ahora = AHORA + 1000; // el segundo se crea después
    const b = await e.sumar(a);
    const r = await pedir(a.token);
    expect(r.statusCode).toBe(200);
    const f = r.json<Familia>();
    expect(f.dispositivos.map((d) => d.device_id)).toEqual([a.device_id, b.device_id]);
    expect(Object.keys(f.dispositivos[0] as Fila).sort()).toEqual(["device_id", "member_id", "nombre", "pendientes", "revocado_en", "ultimo_seq_visto", "ultimo_visto_en"]);
    expect(f.dispositivos[0]).toMatchObject({ member_id: a.member_id, nombre: "Poco X7", revocado_en: null });
    expect(f.dispositivos[1]).toMatchObject({ member_id: b.member_id, nombre: "Celular de Ana", revocado_en: null });
    expect(Object.keys(f).sort()).toEqual(["ahora", "dispositivos", "head_seq"]);
  });

  it("muestra todos los activos y solo los 10 revocados más recientes (la lista no crece para siempre)", async () => {
    const { e, a, pedir } = await entorno();
    const revocados: string[] = [];
    for (let i = 0; i < 12; i++) {
      e.reloj.ahora = AHORA + 1000 * (i + 1);
      const b = await e.sumar(a, { ...NUEVO, apodo: `R${i}` });
      e.servicio.revocarComoAdministrador(b.device_id);
      revocados.push(b.device_id);
    }
    e.reloj.ahora = AHORA + 20_000;
    const activo = await e.sumar(a, { ...NUEVO, apodo: "Activa" });
    const ids = (await pedir(a.token)).json<Familia>().dispositivos.map((d) => d.device_id);
    expect(ids).toEqual([a.device_id, ...revocados.slice(2), activo.device_id]); // del más antiguo al más nuevo, sin los 2 primeros revocados
  });

  it("trae la cabeza del viaje y la hora del servidor", async () => {
    const { e, a, pedir } = await entorno();
    const cabeza = (await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/head`, headers: e.con(a.token) })).json<{ head_seq: number }>().head_seq;
    e.reloj.ahora = AHORA + 12345;
    const f = (await pedir(a.token)).json<Familia>();
    expect([f.head_seq, f.ahora]).toEqual([cabeza, AHORA + 12345]);
  });

  it("refleja lo que cada dispositivo informó en su último pedido (último seq y pendientes) y cuándo lo vio", async () => {
    const { e, a, pedir } = await entorno();
    const b = await e.sumar(a);
    e.reloj.ahora = AHORA + 5000;
    await pedir(b.token, { "x-ultimo-seq": "7", "x-pendientes": "3" });
    e.reloj.ahora = AHORA + 9000;
    const f = (await pedir(a.token, { "x-ultimo-seq": "2", "x-pendientes": "0" })).json<Familia>();
    expect(f.dispositivos.find((d) => d.device_id === b.device_id)).toMatchObject({ ultimo_visto_en: AHORA + 5000, ultimo_seq_visto: 7, pendientes: 3 });
    expect(f.dispositivos.find((d) => d.device_id === a.device_id)).toMatchObject({ ultimo_visto_en: AHORA + 9000, ultimo_seq_visto: 2, pendientes: 0 });
  });

  it("un dispositivo que nunca informó tiene ultimo_visto_en nulo y ceros", async () => {
    const { e, a, pedir } = await entorno();
    const b = await e.sumar(a);
    const f = (await pedir(a.token)).json<Familia>();
    expect(f.dispositivos.find((d) => d.device_id === b.device_id)).toMatchObject({ ultimo_visto_en: null, ultimo_seq_visto: 0, pendientes: 0 });
  });

  it("los revocados siguen en la lista con su hora de revocación", async () => {
    const { e, a, pedir } = await entorno();
    const b = await e.sumar(a);
    e.reloj.ahora = AHORA + 777;
    await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/devices/${b.device_id}/revoke`, headers: e.con(a.token) });
    const f = (await pedir(a.token)).json<Familia>();
    expect(f.dispositivos).toHaveLength(2);
    expect(f.dispositivos.find((d) => d.device_id === b.device_id)?.revocado_en).toBe(AHORA + 777);
    expect(f.dispositivos.find((d) => d.device_id === a.device_id)?.revocado_en).toBeNull();
  });

  it("no filtra tokens ni huellas en ningún campo", async () => {
    const { e, a, pedir } = await entorno();
    const b: Alta = await e.sumar(a);
    const cuerpo = (await pedir(a.token)).body;
    expect(cuerpo).not.toContain(a.token);
    expect(cuerpo).not.toContain(b.token);
    expect(cuerpo).not.toMatch(/[0-9a-f]{64}/);
  });

  it("sin token es 401, con el token de otro viaje es 404 y un revocado es 401", async () => {
    const { e, a, pedir } = await entorno();
    const b = await e.sumar(a);
    expect((await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/familia` })).statusCode).toBe(401);
    const otro = await e.crearViaje();
    expect((await pedir(otro.token)).statusCode).toBe(404);
    await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/devices/${b.device_id}/revoke`, headers: e.con(a.token) });
    expect((await pedir(b.token)).statusCode).toBe(401);
  });

  it("la respuesta no se puede guardar en caché", async () => {
    const { a, pedir } = await entorno();
    expect((await pedir(a.token)).headers["cache-control"]).toBe("private, no-store");
  });

  it("un X-Ultimo-Seq o X-Pendientes ilegible no pisa lo que el dispositivo había informado", async () => {
    const { a, pedir } = await entorno();
    await pedir(a.token, { "x-ultimo-seq": "5", "x-pendientes": "2" });
    const f = (await pedir(a.token, { "x-ultimo-seq": "abc", "x-pendientes": "-1" })).json<Familia>();
    expect(f.dispositivos.find((d) => d.device_id === a.device_id)).toMatchObject({ ultimo_seq_visto: 5, pendientes: 2 });
  });

  it("reemplazar a un integrante con una invitación deja al dispositivo viejo revocado en la lista y al nuevo activo", async () => {
    const { e, a, pedir } = await entorno();
    e.reloj.ahora = AHORA + 1000;
    const b = await e.sumar(a);
    e.reloj.ahora = AHORA + 2000;
    const { cuerpo } = await e.invitar(a.token, a.trip_id, { reemplaza_member_id: b.member_id });
    const r = await e.unirse(cuerpo.codigo, { nombre_dispositivo: "Celular nuevo de Ana", apodo: "Ana", color: "#FFE4E1", emoji: "👩" });
    expect(r.statusCode).toBe(201);
    const nuevo = r.json<Alta>();
    const f = (await pedir(a.token)).json<Familia>();
    expect(f.dispositivos.map((d) => [d.device_id, d.revocado_en === null])).toEqual([[a.device_id, true], [b.device_id, false], [nuevo.device_id, true]]);
    expect(nuevo.member_id).toBe(b.member_id);
  });

  it("un viaje no ve los dispositivos de otro", async () => {
    const { e, a, pedir } = await entorno();
    const otro = await e.crearViaje();
    const f = (await pedir(a.token)).json<Familia>();
    expect(f.dispositivos.map((d) => d.device_id)).toEqual([a.device_id]);
    expect(f.dispositivos.some((d) => d.device_id === otro.device_id)).toBe(false);
  });
});
