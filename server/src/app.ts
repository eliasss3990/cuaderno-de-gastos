import Fastify from "fastify";

export function construirApp() {
  const app = Fastify({ logger: false });
  app.get("/healthz", () => ({ estado: "ok" }));
  return app;
}
