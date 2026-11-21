import Fastify from "fastify";

export function construirApp() {
  const app = Fastify({ logger: false });
  app.get("/healthz", async () => ({ estado: "ok" }));
  return app;
}
