import { describe, expect, it } from "vitest";
import {
  MAX_MONTO_MINOR,
  dividirHaciaAbajo,
  formatear,
  formatearEntrada,
  formatearNumero,
  parsear,
  type Moneda,
} from "../src/dominio/dinero.js";

const MONEDAS: Moneda[] = [
  { codigo: "PYG", decimales: 0, simbolo: "₲" },
  { codigo: "BRL", decimales: 2, simbolo: "R$" },
  { codigo: "KWD", decimales: 3, simbolo: "KD" },
];

// Generador pseudoaleatorio con semilla fija: las corridas son reproducibles.
function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function montoAleatorio(azar: () => number): number {
  const digitos = 1 + Math.floor(azar() * 16);
  const tope = Math.min(10 ** digitos, MAX_MONTO_MINOR);
  return Math.floor(azar() * tope);
}

describe("dinero: propiedades con datos aleatorios", () => {
  const azar = generador(20261121);
  // Bordes fijos (cero, el máximo, potencias de diez y su anterior) más datos aleatorios.
  const bordes = [0, 1, MAX_MONTO_MINOR, MAX_MONTO_MINOR - 1];
  for (let k = 1; k <= 15; k++) bordes.push(10 ** k, 10 ** k - 1);
  const casos = [...bordes, ...Array.from({ length: 3000 }, () => montoAleatorio(azar))];

  for (const m of MONEDAS) {
    it(`${m.codigo}: parsear(formatearNumero(x)) devuelve x`, () => {
      for (const x of casos) {
        const texto = formatearNumero(x, m.decimales);
        expect(parsear(texto, m)).toEqual({ ok: true, minor: x });
      }
    });

    it(`${m.codigo}: formatearEntrada no cambia un texto ya formateado`, () => {
      for (const x of casos) {
        const texto = formatearNumero(x, m.decimales);
        expect(formatearEntrada(texto, m)).toBe(texto);
      }
    });

    it(`${m.codigo}: formatear solo agrega el símbolo y respeta el signo`, () => {
      for (const x of casos.slice(0, 500)) {
        expect(formatear(x, m)).toBe(`${m.simbolo} ${formatearNumero(x, m.decimales)}`);
        if (x > 0) expect(formatear(-x, m)).toBe(`-${m.simbolo} ${formatearNumero(x, m.decimales)}`);
      }
    });

    it(`${m.codigo}: escribir dígito a dígito termina en el valor escrito`, () => {
      for (const x of casos.slice(0, 300)) {
        const escrito = formatearNumero(x, m.decimales).replaceAll(".", "");
        let campo = "";
        for (const tecla of escrito) campo = formatearEntrada(campo + tecla, m);
        expect(parsear(campo, m)).toEqual({ ok: true, minor: x });
      }
    });
  }

  it("rechaza monedas con decimales fuera de rango", () => {
    for (const decimales of [-1, 1.5, 5, Number.NaN]) {
      const rara: Moneda = { codigo: "XXX", decimales, simbolo: "x" };
      expect(() => formatearNumero(5, decimales)).toThrow(RangeError);
      expect(() => formatear(5, rara)).toThrow(RangeError);
      expect(() => parsear("5", rara)).toThrow(RangeError);
      expect(() => formatearEntrada("5", rara)).toThrow(RangeError);
    }
  });

  it("dividirHaciaAbajo cumple q*b <= a < (q+1)*b", () => {
    for (const a of casos) {
      for (const b of [1, 2, 3, 7, 14, 365]) {
        const q = dividirHaciaAbajo(a, b);
        expect(q * b).toBeLessThanOrEqual(a);
        expect(a).toBeLessThan((q + 1) * b);
        const n = dividirHaciaAbajo(-a, b);
        expect(n * b).toBeLessThanOrEqual(-a);
        expect(-a).toBeLessThan((n + 1) * b);
      }
    }
  });
});
