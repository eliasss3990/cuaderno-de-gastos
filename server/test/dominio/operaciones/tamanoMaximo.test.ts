import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Json, Operacion } from "../../../src/dominio/operaciones/operaciones.js";
import { validarOperacion } from "../../../src/dominio/operaciones/validacion.js";
import { MAX_OPERACIONES_POR_PAGINA } from "../../../src/dominio/operaciones/sincronizacion.js";
import { MAX_OPERACIONES_POR_LOTE } from "../../../src/dominio/operaciones/recepcion.js";
import { LIMITE_DEL_LOTE_BYTES } from "../../../src/http/rutasSincronizacion.js";

const vectores = JSON.parse(readFileSync(new URL("../../../../conformance/validacion.json", import.meta.url), "utf8")) as { validas: { op: Operacion }[] };
// el peor caso: los largos se cuentan en unidades UTF-16, y "€" ocupa 3 bytes por unidad (un emoji, 4 bytes en 2 unidades)
const CARACTER = "€";
const TECHO = 20_000;

/** El texto más largo (en caracteres de 4 bytes) que la validación acepta en ese campo, hasta el techo. */
function maximoAceptado(op: Operacion, campo: string): number {
  const con = (n: number) => validarOperacion({ ...op, payload: { ...op.payload, [campo]: CARACTER.repeat(n) } }).ok;
  if (!con(1)) return 0;
  let bajo = 1;
  let alto = TECHO;
  if (con(alto)) return alto;
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2);
    if (con(medio)) bajo = medio;
    else alto = medio;
  }
  return bajo;
}

describe("el tamaño de una operación está acotado por la validación", () => {
  it("ningún campo de texto acepta un largo sin tope, y la operación más grande cabe holgada en un lote", () => {
    let mayor = 0;
    let medidas = 0;
    for (const { op } of vectores.validas) {
      const payload: { [k: string]: Json } = { ...op.payload };
      for (const [campo, valor] of Object.entries(op.payload)) {
        if (typeof valor !== "string") continue;
        const n = maximoAceptado(op, campo);
        expect(n, `${op.tipo}.${campo} acepta un texto sin tope`).toBeLessThan(TECHO);
        if (n > 0) payload[campo] = CARACTER.repeat(n);
      }
      const estirada = { ...op, payload };
      expect(validarOperacion(estirada).ok, `${op.tipo} con todos sus textos al máximo debe seguir siendo válida`).toBe(true);
      medidas += 1;
      mayor = Math.max(mayor, Buffer.byteLength(JSON.stringify(estirada), "utf8"));
    }
    expect(medidas).toBe(vectores.validas.length);
    // medido: la mayor pesa unos 9 KB (un gasto fijo con todos sus textos al máximo en "€"); un lote de 100 de esas, con su
    // sobre, entra en el límite del lote con margen, y una página de bajada de 200 queda en unos 1,8 MB
    expect(mayor).toBeGreaterThan(8_500);
    expect(mayor).toBeLessThan(16 * 1024);
    expect(mayor * MAX_OPERACIONES_POR_PAGINA).toBeLessThan(4 * 1024 * 1024);
    expect(mayor * MAX_OPERACIONES_POR_LOTE * 1.5).toBeLessThan(LIMITE_DEL_LOTE_BYTES);
  });
});
