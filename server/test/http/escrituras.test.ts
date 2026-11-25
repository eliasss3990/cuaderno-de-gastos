import { describe, expect, it } from "vitest";
import { entornoApi, VIAJE } from "../ayudas/entornoApi.js";

describe("aviso de escrituras (para medir el disco solo cuando algo cambió)", () => {
  it("avisa después de una escritura que salió bien, y no en lecturas ni en errores", async () => {
    let avisos = 0;
    const e = entornoApi({ alEscribir: () => (avisos += 1) });
    await e.app.inject({ method: "GET", url: "/healthz" });
    expect(avisos).toBe(0);
    const malo = await e.app.inject({ method: "POST", url: "/v1/trips", payload: {} });
    expect(malo.statusCode).toBe(400);
    expect(avisos).toBe(0);
    const bueno = await e.app.inject({ method: "POST", url: "/v1/trips", payload: VIAJE });
    expect(bueno.statusCode).toBe(201);
    expect(avisos).toBe(1);
    const sinToken = await e.app.inject({ method: "POST", url: `/v1/trips/${bueno.json<{ trip_id: string }>().trip_id}/invitations`, payload: {} });
    expect(sinToken.statusCode).toBe(401);
    expect(avisos).toBe(1);
  });
});
