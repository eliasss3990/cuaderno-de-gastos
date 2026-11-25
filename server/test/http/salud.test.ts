import { describe, expect, it } from "vitest";
import { entornoApi } from "../ayudas/entornoApi.js";

describe("GET /healthz", () => {
  it("responde ok normalmente y alerta (con 200) cuando queda poco disco", async () => {
    let alerta = false;
    const e = entornoApi({ discoEnAlerta: () => alerta });
    const normal = await e.app.inject({ method: "GET", url: "/healthz" });
    expect([normal.statusCode, normal.json()]).toEqual([200, { estado: "ok" }]);
    alerta = true;
    const conAlerta = await e.app.inject({ method: "GET", url: "/healthz" });
    expect([conAlerta.statusCode, conAlerta.json()]).toEqual([200, { estado: "alerta" }]);
  });

  it("sin medición de disco responde ok", async () => {
    expect((await entornoApi().app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ estado: "ok" });
  });
});
