import { describe, expect, it } from "vitest";
import {
  MAX_CONTADOR,
  MAX_MS,
  TOLERANCIA_FUTURO_MS,
  compararHlc,
  corregirMarcaFutura,
  formatearHlc,
  observarHlc,
  parsearHlc,
  siguienteHlc,
  type Hlc,
} from "../src/dominio/reloj.js";

const A = "018f3a6e-0000-7000-8000-000000000001";
const B = "018f3a6e-0000-7000-8000-000000000002";
const C = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const DISPOSITIVOS = [A, B, C];

// Generador pseudoaleatorio con semilla fija: las corridas son reproducibles.
function generador(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function marcaAleatoria(azar: () => number): Hlc {
  const grande = azar() < 0.3;
  const ms = grande ? Math.floor(azar() * MAX_MS) : Math.floor(azar() * 2000);
  const contador = azar() < 0.3 ? Math.floor(azar() * (MAX_CONTADOR + 1)) : Math.floor(azar() * 3);
  return { ms, contador, dispositivo: DISPOSITIVOS[Math.floor(azar() * DISPOSITIVOS.length)] ?? A };
}

describe("reloj híbrido: propiedades con datos aleatorios", () => {
  const azar = generador(20261121);
  const marcas: Hlc[] = [
    { ms: 0, contador: 0, dispositivo: A },
    { ms: MAX_MS, contador: MAX_CONTADOR, dispositivo: C },
    { ms: 255, contador: 255, dispositivo: B },
    { ms: 4096, contador: 4095, dispositivo: A },
    ...Array.from({ length: 3000 }, () => marcaAleatoria(azar)),
  ];

  it("parsear(formatear(x)) devuelve x", () => {
    for (const h of marcas) expect(parsearHlc(formatearHlc(h))).toEqual({ ok: true, hlc: h });
  });

  it("el texto tiene siempre el mismo largo", () => {
    for (const h of marcas) expect(formatearHlc(h)).toHaveLength(13 + 1 + 4 + 1 + 36);
  });

  it("comparar el texto equivale a comparar la marca", () => {
    for (let i = 0; i + 1 < marcas.length; i++) {
      const a = marcas[i] as Hlc;
      const b = marcas[i + 1] as Hlc;
      const porTexto = formatearHlc(a) < formatearHlc(b) ? -1 : formatearHlc(a) > formatearHlc(b) ? 1 : 0;
      expect(compararHlc(a, b)).toBe(porTexto);
      expect(compararHlc(b, a)).toBe(porTexto === 0 ? 0 : -porTexto);
    }
  });

  it("ordenar con el comparador da el mismo resultado que ordenar el texto", () => {
    const porComparador = [...marcas].sort(compararHlc).map(formatearHlc);
    const porTexto = marcas.map(formatearHlc).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(porComparador).toEqual(porTexto);
  });

  it("el orden es antisimétrico y transitivo en tríos al azar", () => {
    for (let i = 0; i < 3000; i++) {
      const a = marcas[Math.floor(azar() * marcas.length)] as Hlc;
      const b = marcas[Math.floor(azar() * marcas.length)] as Hlc;
      const c = marcas[Math.floor(azar() * marcas.length)] as Hlc;
      const ab = compararHlc(a, b);
      expect(compararHlc(b, a)).toBe(ab === 0 ? 0 : -ab);
      if (ab <= 0 && compararHlc(b, c) <= 0) expect(compararHlc(a, c)).toBeLessThanOrEqual(0);
      if (ab < 0 && compararHlc(b, c) <= 0) expect(compararHlc(a, c)).toBe(-1);
    }
  });

  it("siguiente es estrictamente creciente aunque el reloj retroceda o se repita", () => {
    for (const dispositivo of DISPOSITIVOS) {
      let ultimo: Hlc | null = null;
      let reloj = Math.floor(azar() * 1_000_000);
      for (let i = 0; i < 2000; i++) {
        const salto = Math.floor(azar() * 20) - 8; // a veces retrocede, a veces se repite
        reloj = Math.max(0, reloj + salto);
        const nueva: Hlc = siguienteHlc(ultimo, reloj, dispositivo);
        if (ultimo !== null) expect(compararHlc(ultimo, nueva)).toBe(-1);
        expect(nueva.ms).toBeGreaterThanOrEqual(reloj);
        ultimo = nueva;
      }
    }
  });

  it("un dispositivo nunca repite la pareja (milisegundos, contador)", () => {
    for (const dispositivo of DISPOSITIVOS) {
      const vistas = new Set<string>();
      let ultimo: Hlc | null = null;
      for (let i = 0; i < 3000; i++) {
        ultimo = siguienteHlc(ultimo, Math.floor(azar() * 50), dispositivo);
        const clave = `${ultimo.ms}/${ultimo.contador}`;
        expect(vistas.has(clave)).toBe(false);
        vistas.add(clave);
      }
    }
  });

  it("causalidad entre dispositivos: si B vio la marca de A, la siguiente de B queda después aunque su reloj esté atrasado", () => {
    for (let i = 0; i < 3000; i++) {
      const delA = siguienteHlc(null, Math.floor(azar() * 1_000_000), A);
      const propiaDeB = azar() < 0.5 ? null : siguienteHlc(null, Math.floor(azar() * 1_000_000), B);
      const visto = observarHlc(propiaDeB, delA);
      const deB = siguienteHlc(visto, Math.floor(azar() * 1_000_000), B);
      expect(compararHlc(delA, deB)).toBe(-1);
      if (propiaDeB !== null) expect(compararHlc(propiaDeB, deB)).toBe(-1);
    }
  });

  it("observar devuelve siempre la mayor y es conmutativa", () => {
    for (let i = 0; i < 2000; i++) {
      const a = marcaAleatoria(azar);
      const b = marcaAleatoria(azar);
      const ab = observarHlc(a, b);
      const ba = observarHlc(b, a);
      expect(ab).toEqual(ba);
      expect(ab.ms >= a.ms && ab.ms >= b.ms).toBe(true);
    }
  });

  it("corregir de forma monótona: marcas distintas del mismo dispositivo siguen distintas y crecientes", () => {
    const servidor = 5_000_000;
    let guardada: { ms: number; contador: number } | null = null;
    let previa: Hlc | null = null;
    for (let i = 0; i < 2000; i++) {
      const entrante: Hlc = { ms: servidor + 600_000, contador: Math.floor(azar() * 5), dispositivo: A };
      const r = corregirMarcaFutura(entrante, servidor, guardada);
      expect(r.corregida).toBe(true);
      if (previa !== null) expect(compararHlc(previa, r.hlc)).toBe(-1);
      guardada = observarHlc(guardada, r.hlc);
      previa = r.hlc;
    }
  });

  it("el desborde del contador pasa de ffff a 0000 con un milisegundo más", () => {
    let ultimo: Hlc = { ms: 10, contador: MAX_CONTADOR - 3, dispositivo: A };
    for (let i = 0; i < 10; i++) {
      const nueva = siguienteHlc(ultimo, 5, A);
      expect(compararHlc(ultimo, nueva)).toBe(-1);
      ultimo = nueva;
    }
    expect(ultimo).toEqual({ ms: 11, contador: 6, dispositivo: A });
  });

  it("corregirMarcaFutura: solo corrige por encima de la tolerancia y deja la marca intacta si no", () => {
    for (const h of marcas.slice(0, 1500)) {
      const servidor = Math.floor(azar() * MAX_MS * 0.5);
      const r = corregirMarcaFutura(h, servidor, null);
      if (h.ms > servidor + TOLERANCIA_FUTURO_MS) {
        expect(r.corregida).toBe(true);
        expect(r.hlc).toEqual({ ms: servidor, contador: 0, dispositivo: h.dispositivo });
      } else {
        expect(r.corregida).toBe(false);
        expect(r.hlc).toBe(h);
      }
    }
  });

  it("corregirMarcaFutura: casos pegados al borde de la tolerancia", () => {
    for (let i = 0; i < 2000; i++) {
      const servidor = 1_000_000 + Math.floor(azar() * 1_000_000);
      const delta = Math.floor(azar() * 5) - 2; // de -2 a +2 ms alrededor del borde
      const h: Hlc = { ms: servidor + TOLERANCIA_FUTURO_MS + delta, contador: Math.floor(azar() * 4), dispositivo: A };
      const r = corregirMarcaFutura(h, servidor, null);
      expect(r.corregida).toBe(delta > 0);
    }
  });

  it("rechaza marcas y horas fuera de rango", () => {
    expect(() => formatearHlc({ ms: -1, contador: 0, dispositivo: A })).toThrow(RangeError);
    expect(() => formatearHlc({ ms: MAX_MS + 1, contador: 0, dispositivo: A })).toThrow(RangeError);
    expect(() => formatearHlc({ ms: 0, contador: MAX_CONTADOR + 1, dispositivo: A })).toThrow(RangeError);
    expect(() => formatearHlc({ ms: 0, contador: 0, dispositivo: A.toUpperCase() })).toThrow(RangeError);
    expect(() => formatearHlc({ ms: 0.5, contador: 0, dispositivo: A })).toThrow(RangeError);
    expect(() => siguienteHlc(null, Number.NaN, A)).toThrow(RangeError);
    expect(() => compararHlc({ ms: Number.NaN, contador: 0, dispositivo: A }, { ms: 1, contador: 0, dispositivo: A })).toThrow(RangeError);
    expect(() => observarHlc(null, { ms: -1, contador: 0 })).toThrow(RangeError);
  });
});
