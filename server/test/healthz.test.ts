import { describe, expect, it } from "vitest";
import { construirApp } from "../src/app.js";

describe("GET /healthz", () => {
  it("responde ok sin token", async () => {
    const app = construirApp();
    const r = await app.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ estado: "ok" });
  });
});
