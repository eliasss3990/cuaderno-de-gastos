import { describe, expect, it } from "vitest";
import { clasificarNombre, detectarTipo, EXTENSION_DE, UUID } from "../../../src/dominio/adjuntos/archivos.js";
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

describe("clasificarNombre", () => {
  const ID = "aaaaaaaa-0000-4000-8000-000000000001";

  it("reconoce un archivo por cada extensión permitida y devuelve a qué adjunto pertenece", () => {
    for (const ext of ["jpg", "png", "webp", "pdf"]) expect([ext, clasificarNombre(`${ID}.${ext}`)]).toEqual([ext, { tipo: "archivo", adjuntoId: ID }]);
  });

  it("reconoce la miniatura (solo .thumb.jpg) y devuelve su adjunto", () => {
    expect(clasificarNombre(`${ID}.thumb.jpg`)).toEqual({ tipo: "miniatura", adjuntoId: ID });
    for (const malo of [`${ID}.thumb.png`, `${ID}.thumb.jpg.bak`, `x${ID}.thumb.jpg`, `${ID}.thumb`]) expect([malo, clasificarNombre(malo).tipo]).toEqual([malo, "desconocido"]);
  });

  it("reconoce un temporal: 16 hexadecimales en minúscula y .tmp, sin adjunto", () => {
    expect(clasificarNombre("0123456789abcdef.tmp")).toEqual({ tipo: "temporal", adjuntoId: null });
    for (const malo of ["0123456789abcde.tmp", "0123456789abcdef0.tmp", "0123456789ABCDEF.tmp", "0123456789abcdeg.tmp", "x0123456789abcdef.tmp", "0123456789abcdef.tmp.bak", "0123456789abcdef.tmpx", ".tmp"]) {
      expect([malo, clasificarNombre(malo)]).toEqual([malo, { tipo: "desconocido", adjuntoId: null }]);
    }
  });

  it("todo lo demás es desconocido: otras extensiones, mayúsculas, texto antes o después y rutas", () => {
    for (const malo of ["", "notas.txt", `${ID}.exe`, `${ID}.gif`, `${ID}`, `${ID}.`, `${ID}.jpg.bak`, `x${ID}.jpg`, `${ID.toUpperCase()}.jpg`, `${ID.slice(1)}.jpg`, `../${ID}.jpg`, `${ID}.jpg/`, `${ID}.jpg\n`, `${ID}.JPG`, `a/${ID}.pdf`]) {
      expect([malo, clasificarNombre(malo)]).toEqual([malo, { tipo: "desconocido", adjuntoId: null }]);
    }
  });
});

