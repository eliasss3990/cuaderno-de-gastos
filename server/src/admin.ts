// `node dist/admin.js <comando>`: administración del servidor desde la línea de comandos (ver src/admin/comandos.ts).

import { principal } from "./admin/principal.js";

process.exitCode = principal(process.argv.slice(2), process.env, {
  salida: (linea) => process.stdout.write(`${linea}\n`),
  error: (linea) => process.stderr.write(`${linea}\n`),
});
