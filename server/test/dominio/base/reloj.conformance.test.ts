import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_CONTADOR,
  MAX_MS,
  TOLERANCIA_FUTURO_MS,
  ahoraCorregida,
  aprenderDesfase,
  compararHlc,
  corregirMarcaFutura,
  formatearHlc,
  observarHlc,
  parsearHlc,
  siguienteHlc,
  type Hlc,
} from "../../../src/dominio/base/reloj.js";

interface Marca { ms: number; contador: number; dispositivo: string }
type Par = { ms: number; contador: number };
interface Vectores {
  maxMs: number;
  maxContador: number;
  toleranciaFuturoMs: number;
  formatear: (Marca & { esperado: string })[];
  parsear: { texto: string; esperado?: Marca; error?: string }[];
  comparar: { a: Marca; b: Marca; esperado: number }[];
  siguiente: {
    nombre: string;
    dispositivo: string;
    inicio: { ms: number; contador: number } | null;
    pasos: { ahora: number; esperado: { ms: number; contador: number } }[];
  }[];
  siguienteError: { inicio: { ms: number; contador: number } | null; ahora: number; dispositivo: string }[];
  corregirFuturo: { hlc: Marca; ahoraServidor: number; esperado: Marca & { corregida: boolean } }[];
  aprenderDesfase: { servidor: number; local: number; desfase: number }[];
  ahoraCorregido: { local: number; desfase: number; esperado: number }[];
  observar: { ultimo: Par | null; remota: Par; ahora: number; dispositivo: string; esperadoObservado: Par; esperadoSiguiente: Par }[];
  observarError: { ultimo: Par | null; remota: Par }[];
  corregirFuturoMonotono: { hlc: Marca; ahoraServidor: number; ultimoDelDispositivo: Par | null; esperado: Marca & { corregida: boolean } }[];
  corregirFuturoError: { hlc: Marca; ahoraServidor: number; ultimoDelDispositivo: Par | null }[];
  aprenderDesfaseError: { servidor: number; local: number }[];
  ahoraCorregidoError: { local: number; desfase: number }[];
  compararError: { a: Marca; b: Marca }[];
  formatearError: Marca[];
}

const v = JSON.parse(readFileSync(new URL("../../../../conformance/reloj.json", import.meta.url), "utf8")) as Vectores;

describe("reloj híbrido: vectores de conformidad", () => {
  it("las constantes de los vectores son las del módulo", () => {
    expect(v.maxMs).toBe(MAX_MS);
    expect(v.maxContador).toBe(MAX_CONTADOR);
    expect(v.toleranciaFuturoMs).toBe(TOLERANCIA_FUTURO_MS);
  });

  it.each(v.formatear)("formatear $ms/$contador -> $esperado", ({ esperado, ...h }) => {
    expect(formatearHlc(h)).toBe(esperado);
  });

  it.each(v.parsear)("parsear '$texto'", ({ texto, esperado, error }) => {
    const r = parsearHlc(texto);
    if (error !== undefined) expect(r).toEqual({ ok: false, error });
    else expect(r).toEqual({ ok: true, hlc: esperado });
  });

  it.each(v.comparar)("comparar $a.ms/$a.contador con $b.ms/$b.contador -> $esperado", ({ a, b, esperado }) => {
    expect(compararHlc(a, b)).toBe(esperado);
    expect(compararHlc(b, a)).toBe(esperado === 0 ? 0 : -esperado);
  });

  it.each(v.siguiente)("siguiente: $nombre", ({ dispositivo, inicio, pasos }) => {
    let ultimo: { ms: number; contador: number } | null = inicio;
    for (const { ahora, esperado } of pasos) {
      const h: Hlc = siguienteHlc(ultimo, ahora, dispositivo);
      expect({ ms: h.ms, contador: h.contador }).toEqual(esperado);
      expect(h.dispositivo).toBe(dispositivo);
      ultimo = h;
    }
  });

  it.each(v.siguienteError)("siguiente falla con $ahora (inicio $inicio)", ({ inicio, ahora, dispositivo }) => {
    expect(() => siguienteHlc(inicio, ahora, dispositivo)).toThrow(RangeError);
  });

  it.each(v.corregirFuturo)("corregirMarcaFutura $hlc.ms con servidor $ahoraServidor", ({ hlc, ahoraServidor, esperado }) => {
    const r = corregirMarcaFutura(hlc, ahoraServidor, null);
    expect(r.corregida).toBe(esperado.corregida);
    expect(r.hlc).toEqual({ ms: esperado.ms, contador: esperado.contador, dispositivo: esperado.dispositivo });
  });

  it.each(v.aprenderDesfase)("aprenderDesfase $servidor - $local = $desfase", ({ servidor, local, desfase }) => {
    expect(aprenderDesfase(servidor, local)).toBe(desfase);
  });

  it.each(v.ahoraCorregido)("ahoraCorregida $local + $desfase = $esperado", ({ local, desfase, esperado }) => {
    expect(ahoraCorregida(local, desfase)).toBe(esperado);
  });

  it.each(v.observar)("observar y luego siguiente: $ultimo + $remota", ({ ultimo, remota, ahora, dispositivo, esperadoObservado, esperadoSiguiente }) => {
    const visto = observarHlc(ultimo, remota);
    expect(visto).toEqual(esperadoObservado);
    const h = siguienteHlc(visto, ahora, dispositivo);
    expect({ ms: h.ms, contador: h.contador }).toEqual(esperadoSiguiente);
  });

  it.each(v.observarError)("observar falla con $remota (último $ultimo)", ({ ultimo, remota }) => {
    expect(() => observarHlc(ultimo, remota)).toThrow(RangeError);
  });

  it.each(v.corregirFuturoMonotono)("corregir con la última del dispositivo $ultimoDelDispositivo", ({ hlc, ahoraServidor, ultimoDelDispositivo, esperado }) => {
    const r = corregirMarcaFutura(hlc, ahoraServidor, ultimoDelDispositivo);
    expect(r.corregida).toBe(esperado.corregida);
    expect(r.hlc).toEqual({ ms: esperado.ms, contador: esperado.contador, dispositivo: esperado.dispositivo });
    if (ultimoDelDispositivo !== null) {
      expect(compararHlc({ ...ultimoDelDispositivo, dispositivo: hlc.dispositivo }, r.hlc)).toBe(-1);
    }
  });

  it.each(v.corregirFuturoError)("corregir falla con entradas inválidas ($hlc.ms/$hlc.contador, servidor $ahoraServidor)", ({ hlc, ahoraServidor, ultimoDelDispositivo }) => {
    expect(() => corregirMarcaFutura(hlc, ahoraServidor, ultimoDelDispositivo)).toThrow(RangeError);
  });

  it.each(v.aprenderDesfaseError)("aprenderDesfase falla con $servidor y $local", ({ servidor, local }) => {
    expect(() => aprenderDesfase(servidor, local)).toThrow(RangeError);
  });

  it.each(v.ahoraCorregidoError)("ahoraCorregida falla con $local y $desfase", ({ local, desfase }) => {
    expect(() => ahoraCorregida(local, desfase)).toThrow(RangeError);
  });

  it.each(v.compararError)("comparar falla con una marca inválida ($a.ms/$a.contador y $b.ms/$b.contador)", ({ a, b }) => {
    expect(() => compararHlc(a, b)).toThrow(RangeError);
  });

  it.each(v.formatearError)("formatear falla con una marca inválida ($ms/$contador/$dispositivo)", (h) => {
    expect(() => formatearHlc(h)).toThrow(RangeError);
  });
});
