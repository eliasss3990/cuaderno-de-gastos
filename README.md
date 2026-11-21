# Cuaderno de Gastos

App Android familiar (hasta 4 celulares) para anotar los gastos de un viaje, sin conexión y con sincronización a un servicio propio.

- `app/` — aplicación Android (Kotlin, Compose).
- `server/` — servicio Node (Fastify, SQLite).
- `conformance/` — vectores de conformidad compartidos por las pruebas de Kotlin y TypeScript.

## Ramas
El trabajo entra a `next` por PR (`feat/*`, `fix/*`); `main` solo recibe PRs de `next` o de `hotfix/*`. Merges con `--merge`.
