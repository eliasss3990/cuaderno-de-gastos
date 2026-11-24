import { describe, expect, it } from "vitest";
import { detectarTipo, EXTENSION_DE, UUID } from "../../../src/dominio/adjuntos/archivos.js";
import { jpeg, pdf, png, webp } from "../../ayudas/adjuntos.js";

describe("detectarTipo", () => {
  it("reconoce cada tipo permitido por sus primeros bytes", () => {
    expect(detectarTipo(jpeg())).toBe("image/jpeg");
    expect(detectarTipo(png())).toBe("image/png");
    expect(detectarTipo(webp())).toBe("image/webp");
    expect(detectarTipo(pdf())).toBe("application/pdf");
  });

  it("no reconoce lo vacío, lo corto ni lo que empieza distinto", () => {
    expect(detectarTipo(new Uint8Array())).toBeNull();
    expect(detectarTipo(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(detectarTipo(Buffer.from("GIF89a"))).toBeNull();
    expect(detectarTipo(Buffer.from("<html>"))).toBeNull();
    expect(detectarTipo(Buffer.from("MZ\x90\x00"))).toBeNull();
  });

  it("una firma incompleta o con un solo byte distinto no cuenta", () => {
    expect(detectarTipo(Uint8Array.from([0xff, 0xd8, 0xfe]))).toBeNull();
    const casiPng = png();
    casiPng[7] = 0x0b;
    expect(detectarTipo(casiPng)).toBeNull();
    expect(detectarTipo(Buffer.from("%PDF"))).toBeNull();
  });

  it("WebP exige RIFF al principio y WEBP en los bytes 8 a 11", () => {
    const sinWebp = webp();
    sinWebp.write("WEBX", 8);
    expect(detectarTipo(sinWebp)).toBeNull();
    const sinRiff = webp();
    sinRiff.write("RIFX", 0);
    expect(detectarTipo(sinRiff)).toBeNull();
    expect(detectarTipo(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE")]))).toBeNull();
  });

  it("un PDF o una imagen dentro de otro contenido no se reconoce (solo cuentan los primeros bytes)", () => {
    expect(detectarTipo(Buffer.concat([Buffer.from("x"), pdf()]))).toBeNull();
    expect(detectarTipo(Buffer.concat([Buffer.from("x"), jpeg()]))).toBeNull();
  });
});

describe("identificadores y extensiones", () => {
  it("la extensión la fija el tipo", () => {
    expect(EXTENSION_DE).toEqual({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" });
  });

  it("solo es UUID un texto de 8-4-4-4-12 hexadecimales en minúscula y nada más", () => {
    expect(UUID.test("018f3a6e-7000-7000-8000-000000000001")).toBe(true);
    for (const malo of ["", "../etc/passwd", "018F3A6E-7000-7000-8000-000000000001", "018f3a6e-7000-7000-8000-00000000000", "018f3a6e-7000-7000-8000-0000000000012", "x018f3a6e-7000-7000-8000-000000000001", "018f3a6e-7000-7000-8000-000000000001\n", "018f3a6e-7000-7000-8000-000000000001/..", "018f3a6e70007000800000000000001a"]) {
      expect([malo, UUID.test(malo)]).toEqual([malo, false]);
    }
  });
});
