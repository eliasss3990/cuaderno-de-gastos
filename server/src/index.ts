import { construirApp } from "./app.js";

const app = construirApp();
const puerto = Number(process.env.PORT ?? 8094);
await app.listen({ port: puerto, host: "0.0.0.0" });
