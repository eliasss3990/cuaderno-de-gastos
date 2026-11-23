import { describe, expect, it } from "vitest";
import { compararVersiones, parsearVersion } from "../../src/http/versiones.js";

describe("parsearVersion", () => {
  it("lee hasta 4 números separados por puntos y descarta el sufijo", () => {
    expect(parsearVersion("1")).toEqual([1]);
    expect(parsearVersion("0.1.1")).toEqual([0, 1, 1]);
    expect(parsearVersion("1.2.3.4")).toEqual([1, 2, 3, 4]);
    expect(parsearVersion("0.1.1-debug")).toEqual([0, 1, 1]);
    expect(parsearVersion("2.0.0+build.7")).toEqual([2, 0, 0]);
    expect(parsearVersion(" 1.2.3 ")).toEqual([1, 2, 3]);
    expect(parsearVersion("999999.0")).toEqual([999999, 0]);
  });

  it("lo que no tiene esa forma da null", () => {
    for (const malo of ["", "a.b", "1.", ".1", "1..2", "1.2.3.4.5", "v1.2", "1.2-", "-1", "1,2", "1.2 3", "1234567", `1.${"9".repeat(7)}`, undefined, null, 5, {}, ["1.2"]]) {
      expect([malo, parsearVersion(malo)]).toEqual([malo, null]);
    }
  });

  it("un sufijo demasiado largo o con caracteres raros no se acepta", () => {
    expect(parsearVersion(`1.0-${"a".repeat(31)}`)).toBeNull();
    expect(parsearVersion(`1.0-${"a".repeat(30)}`)).toEqual([1, 0]);
    expect(parsearVersion("1.0-a b")).toBeNull();
  });
});

describe("compararVersiones", () => {
  it("compara número a número y los que faltan valen 0", () => {
    expect(compararVersiones([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compararVersiones([1, 2], [1, 2, 0])).toBe(0);
    expect(compararVersiones([1], [1, 0, 0, 0])).toBe(0);
    expect(compararVersiones([0, 1, 1], [0, 1, 2])).toBe(-1);
    expect(compararVersiones([0, 2, 0], [0, 1, 9])).toBe(1);
    expect(compararVersiones([1, 0, 0], [0, 99, 99])).toBe(1);
    expect(compararVersiones([0, 9], [0, 10])).toBe(-1); // numérico, no por texto
    expect(compararVersiones([1, 2], [1, 2, 1])).toBe(-1);
    expect(compararVersiones([1, 2, 1], [1, 2])).toBe(1);
  });
});
