import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inspeccionar, inspeccionarMiniatura, MAX_LADO_MINIATURA_PX, MAX_LADO_PX, MAX_PIXELES, type Inspeccion } from "../../../src/dominio/adjuntos/formatos.js";
import { jpeg, pdf, png, u16be, u16le, u32be, u32le, webp } from "../../ayudas/adjuntos.js";

const causa = (r: Inspeccion): string => (r.ok ? "ok" : r.causa);
const motivo = (r: Inspeccion): string => (r.ok ? "" : r.motivo);
const cortar = (b: Buffer, quitar: number): Buffer => b.subarray(0, b.length - quitar);

/** Un JPEG armado a mano: SOI, los segmentos que se pidan y EOI. */
const jpegCon = (...segmentos: Buffer[]): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segmentos, Buffer.from([0xff, 0xd9])]);
const segmento = (marcador: number, datos: Buffer): Buffer => Buffer.concat([Buffer.from([0xff, marcador]), u16be(datos.length + 2), datos]);
const cuadro = (marcador: number, ancho: number, alto: number): Buffer => segmento(marcador, Buffer.concat([Buffer.from([8]), u16be(alto), u16be(ancho), Buffer.from([1, 1, 0x11, 0])]));

describe("topes", () => {
  it("los valores son los acordados: 8192 px de lado, 40 millones de píxeles y miniaturas de hasta 1024 px", () => {
    expect([MAX_LADO_PX, MAX_PIXELES, MAX_LADO_MINIATURA_PX]).toEqual([8192, 40_000_000, 1024]);
  });

  it("40 millones de píxeles justos se aceptan y uno más no", () => {
    expect(inspeccionar(jpeg(100, 8000, 5000), "image/jpeg").ok).toBe(true);
    expect(causa(inspeccionar(jpeg(100, 8000, 5001), "image/jpeg"))).toBe("dimensiones");
  });
});

describe("JPEG", () => {
  it("los segmentos de tablas (DHT, JPG, DAC) que vienen antes del cuadro no se toman por un cuadro", () => {
    for (const marcador of [0xc4, 0xc8, 0xcc]) {
      const r = inspeccionar(jpegCon(segmento(marcador, Buffer.alloc(20, 0)), cuadro(0xc0, 640, 480)), "image/jpeg");
      expect([marcador, r.ok]).toEqual([marcador, true]);
    }
  });

  it("los dos últimos bytes tienen que ser el EOI, cada uno por su lado", () => {
    const sinUltimo = Buffer.from(jpeg(200));
    sinUltimo[sinUltimo.length - 1] = 0x00;
    const sinPenultimo = Buffer.from(jpeg(200));
    sinPenultimo[sinPenultimo.length - 2] = 0x00;
    expect(motivo(inspeccionar(sinUltimo, "image/jpeg"))).toBe("el JPEG está cortado (no termina como debe)");
    expect(motivo(inspeccionar(sinPenultimo, "image/jpeg"))).toBe("el JPEG está cortado (no termina como debe)");
  });

  it("acepta un segundo SOI y los reinicios D0 a D7 antes del cuadro", () => {
    expect(inspeccionar(jpegCon(Buffer.from([0xff, 0xd8]), cuadro(0xc0, 10, 10)), "image/jpeg").ok).toBe(true);
    for (const rst of [0xd0, 0xd3, 0xd7]) expect([rst, inspeccionar(jpegCon(Buffer.from([0xff, rst]), cuadro(0xc0, 10, 10)), "image/jpeg").ok]).toEqual([rst, true]);
  });

  it("un EOI o un comienzo de datos (SOS) antes del cuadro invalida el archivo, aunque después venga un cuadro", () => {
    const eoiAntes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), cuadro(0xc0, 10, 10), Buffer.from([0xff, 0xd9])]);
    expect(motivo(inspeccionar(eoiAntes, "image/jpeg"))).toBe("el JPEG no declara su tamaño");
    const sosAntes = jpegCon(segmento(0xda, Buffer.alloc(6, 1)), cuadro(0xc0, 10, 10));
    expect(motivo(inspeccionar(sosAntes, "image/jpeg"))).toBe("el JPEG no declara su tamaño");
  });

  it("un segmento que termina justo donde termina el archivo no está cortado (y uno que se pasa por un byte sí)", () => {
    const justo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe]), u16be(6), Buffer.from([0x61, 0x62, 0xff, 0xd9])]);
    expect(motivo(inspeccionar(justo, "image/jpeg"))).toBe("el JPEG no declara su tamaño");
    const pasado = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe]), u16be(7), Buffer.from([0x61, 0x62, 0xff, 0xd9])]);
    expect(motivo(inspeccionar(pasado, "image/jpeg"))).toBe("el JPEG tiene un segmento cortado");
  });

  it("con cuatro bytes por delante el marcador todavía se lee (el último segmento posible)", () => {
    const r = inspeccionar(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]), "image/jpeg");
    expect(motivo(r)).toBe("el JPEG tiene un segmento cortado");
  });

  it("un cuadro tiene que traer al menos ocho bytes de longitud: con siete falta el número de componentes", () => {
    const sieteBytes = jpegCon(segmento(0xc0, Buffer.from([8, 0, 1, 0, 1])));
    expect(motivo(inspeccionar(sieteBytes, "image/jpeg"))).toBe("el JPEG tiene la cabecera de cuadro incompleta");
  });

  it("acepta uno completo con sus dimensiones", () => {
    expect(inspeccionar(jpeg(), "image/jpeg")).toEqual({ ok: true });
    expect(inspeccionar(jpeg(5000, 4000, 3000), "image/jpeg")).toEqual({ ok: true });
  });

  it("acepta cualquier tipo de cuadro (secuencial, extendido, progresivo, aritmético)", () => {
    for (const marcador of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
      expect([marcador, inspeccionar(jpegCon(cuadro(marcador, 100, 100)), "image/jpeg").ok]).toEqual([marcador, true]);
    }
  });

  it("salta los segmentos que vienen antes del cuadro (APP0, tablas, comentario) y el relleno 0xFF", () => {
    const antes = [segmento(0xe0, Buffer.from("JFIF\0")), segmento(0xdb, Buffer.alloc(65, 1)), segmento(0xc4, Buffer.alloc(20, 1)), segmento(0xfe, Buffer.from("hola"))];
    expect(inspeccionar(jpegCon(...antes, cuadro(0xc0, 640, 480)), "image/jpeg")).toEqual({ ok: true });
    expect(inspeccionar(jpegCon(Buffer.from([0xff, 0xff, 0xff]).subarray(0, 1), ...antes.slice(0, 1), Buffer.from([0xff]), cuadro(0xc0, 10, 10)), "image/jpeg").ok).toBe(true);
  });

  it("salta marcadores sin longitud (reinicios y TEM)", () => {
    expect(inspeccionar(jpegCon(Buffer.from([0xff, 0xd0, 0xff, 0x01]), cuadro(0xc0, 10, 10)), "image/jpeg").ok).toBe(true);
  });

  it("uno cortado (sin EOI al final) es inválido", () => {
    const r = inspeccionar(cortar(jpeg(), 2), "image/jpeg");
    expect([causa(r), motivo(r)]).toEqual(["invalido", "el JPEG está cortado (no termina como debe)"]);
    expect(causa(inspeccionar(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg"))).toBe("invalido");
    expect(causa(inspeccionar(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"))).toBe("invalido");
  });

  it("sin cuadro antes de los datos (SOS) o del final (EOI), o con un segmento raro, es inválido", () => {
    expect(motivo(inspeccionar(jpegCon(segmento(0xda, Buffer.alloc(6, 1))), "image/jpeg"))).toBe("el JPEG no declara su tamaño");
    expect(motivo(inspeccionar(jpegCon(), "image/jpeg"))).toBe("el JPEG no declara su tamaño");
    expect(motivo(inspeccionar(jpegCon(segmento(0xe0, Buffer.from("x"))), "image/jpeg"))).toBe("el JPEG no declara su tamaño");
    expect(motivo(inspeccionar(Buffer.concat([Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78]), Buffer.from([0xff, 0xd9])]), "image/jpeg"))).toBe("el JPEG tiene un segmento inválido");
  });

  it("un segmento que se sale del archivo, o con longitud menor que 2, es inválido", () => {
    const largo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), u16be(60000), Buffer.from("poco"), Buffer.from([0xff, 0xd9])]);
    expect(motivo(inspeccionar(largo, "image/jpeg"))).toBe("el JPEG tiene un segmento cortado");
    const corto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), u16be(1), Buffer.from("xxxx"), Buffer.from([0xff, 0xd9])]);
    expect(motivo(inspeccionar(corto, "image/jpeg"))).toBe("el JPEG tiene un segmento cortado");
  });

  it("un cuadro con la cabecera incompleta es inválido", () => {
    expect(motivo(inspeccionar(jpegCon(segmento(0xc0, Buffer.from([8, 0, 1]))), "image/jpeg"))).toBe("el JPEG tiene la cabecera de cuadro incompleta");
  });

  it("dimensiones: cero es inválido; los topes se respetan justo en el borde", () => {
    expect(causa(inspeccionar(jpeg(100, 0, 100), "image/jpeg"))).toBe("invalido");
    expect(causa(inspeccionar(jpeg(100, 100, 0), "image/jpeg"))).toBe("invalido");
    expect(inspeccionar(jpeg(100, MAX_LADO_PX, 4882), "image/jpeg").ok).toBe(true);
    expect(MAX_LADO_PX * 4882).toBeLessThanOrEqual(MAX_PIXELES);
    expect(causa(inspeccionar(jpeg(100, MAX_LADO_PX, 4883), "image/jpeg"))).toBe("dimensiones");
    expect(causa(inspeccionar(jpeg(100, MAX_LADO_PX + 1, 10), "image/jpeg"))).toBe("dimensiones");
    expect(causa(inspeccionar(jpeg(100, 10, MAX_LADO_PX + 1), "image/jpeg"))).toBe("dimensiones");
    expect(causa(inspeccionar(jpeg(100, 7000, 7000), "image/jpeg"))).toBe("dimensiones");
    expect(motivo(inspeccionar(jpeg(100, 9000, 100), "image/jpeg"))).toBe("la imagen es demasiado grande (9000 × 100)");
  });
});

describe("PNG", () => {
  it("el mensaje de un tamaño enorme dice ancho × alto en ese orden", () => {
    expect(motivo(inspeccionar(png(100, 9000, 100), "image/png"))).toBe("la imagen es demasiado grande (9000 × 100)");
    expect(motivo(inspeccionar(png(100, 100, 9000), "image/png"))).toBe("la imagen es demasiado grande (100 × 9000)");
  });

  it("acepta uno completo", () => {
    expect(inspeccionar(png(), "image/png")).toEqual({ ok: true });
    expect(inspeccionar(png(3000, 1920, 1080), "image/png")).toEqual({ ok: true });
  });

  it("uno incompleto, sin IHDR al principio o con la cabecera dañada es inválido", () => {
    expect(motivo(inspeccionar(png().subarray(0, 44), "image/png"))).toBe("el PNG está incompleto");
    const sinIhdr = Buffer.from(png());
    sinIhdr.write("IHDX", 12);
    expect(motivo(inspeccionar(sinIhdr, "image/png"))).toBe("el PNG no empieza con su cabecera");
    const largoMalo = Buffer.from(png());
    largoMalo[11] = 12;
    expect(motivo(inspeccionar(largoMalo, "image/png"))).toBe("el PNG no empieza con su cabecera");
    const crcMalo = Buffer.from(png());
    crcMalo[16] = 0x01; // cambia el ancho sin recalcular el CRC
    expect(motivo(inspeccionar(crcMalo, "image/png"))).toBe("la cabecera del PNG está dañada");
  });

  it("uno cortado (sin IEND) es inválido, también si le falta un solo byte o el final es otro", () => {
    expect(motivo(inspeccionar(cortar(png(), 1), "image/png"))).toBe("el PNG está cortado (no termina como debe)");
    expect(motivo(inspeccionar(cortar(png(), 12), "image/png"))).toBe("el PNG está cortado (no termina como debe)");
    const otroFin = Buffer.from(png());
    otroFin[otroFin.length - 1] = 0x00;
    expect(causa(inspeccionar(otroFin, "image/png"))).toBe("invalido");
  });

  it("dimensiones: cero inválido y topes justo en el borde", () => {
    expect(causa(inspeccionar(png(100, 0, 10), "image/png"))).toBe("invalido");
    expect(causa(inspeccionar(png(100, 10, 0), "image/png"))).toBe("invalido");
    expect(inspeccionar(png(100, MAX_LADO_PX, 4882), "image/png").ok).toBe(true);
    expect(causa(inspeccionar(png(100, MAX_LADO_PX, 4883), "image/png"))).toBe("dimensiones");
    expect(causa(inspeccionar(png(100, 100000, 10), "image/png"))).toBe("dimensiones");
    expect(causa(inspeccionar(png(100, 0xffffffff, 0xffffffff), "image/png"))).toBe("dimensiones");
  });
});

/** WebP armados a mano para cada tipo de cabecera. */
const riff = (cuerpo: Buffer): Buffer => Buffer.concat([Buffer.from("RIFF"), u32le(cuerpo.length + 4), Buffer.from("WEBP"), cuerpo]);
const vp8 = (ancho: number, alto: number, inicio = [0x9d, 0x01, 0x2a]): Buffer => riff(Buffer.concat([Buffer.from("VP8 "), u32le(10), Buffer.from([0, 0, 0]), Buffer.from(inicio), u16le(ancho), u16le(alto)]));
const vp8l = (ancho: number, alto: number, firma = 0x2f): Buffer => riff(Buffer.concat([Buffer.from("VP8L"), u32le(5), Buffer.from([firma]), u32le(((ancho - 1) & 0x3fff) | (((alto - 1) & 0x3fff) << 14))]));

describe("WebP", () => {
  it("el mensaje de un tamaño enorme dice ancho × alto en ese orden, en cada tipo de cabecera", () => {
    expect(motivo(inspeccionar(vp8(9000, 100), "image/webp"))).toBe("la imagen es demasiado grande (9000 × 100)");
    expect(motivo(inspeccionar(vp8(100, 9000), "image/webp"))).toBe("la imagen es demasiado grande (100 × 9000)");
    expect(motivo(inspeccionar(vp8l(9000, 100), "image/webp"))).toBe("la imagen es demasiado grande (9000 × 100)");
    expect(motivo(inspeccionar(vp8l(100, 9000), "image/webp"))).toBe("la imagen es demasiado grande (100 × 9000)");
    expect(motivo(inspeccionar(webp(100, 9000, 100), "image/webp"))).toBe("la imagen es demasiado grande (9000 × 100)");
    expect(motivo(inspeccionar(webp(100, 100, 9000), "image/webp"))).toBe("la imagen es demasiado grande (100 × 9000)");
  });

  it("los largos mínimos: VP8L desde 25 bytes, VP8 y VP8X desde 30", () => {
    const largo = (tipo: string, total: number): Buffer => riff(Buffer.concat([Buffer.from(tipo), Buffer.alloc(total - 16)]));
    expect(motivo(inspeccionar(largo("VP8L", 24), "image/webp"))).toBe("el WebP está incompleto");
    expect(motivo(inspeccionar(largo("VP8L", 25), "image/webp"))).toBe("el WebP tiene la cabecera sin pérdida dañada");
    expect(motivo(inspeccionar(largo("VP8 ", 29), "image/webp"))).toBe("el WebP está incompleto");
    expect(motivo(inspeccionar(largo("VP8 ", 30), "image/webp"))).toBe("el WebP tiene la cabecera de cuadro dañada");
    expect(motivo(inspeccionar(largo("VP8X", 29), "image/webp"))).toBe("el WebP está incompleto");
    expect(inspeccionar(largo("VP8X", 30), "image/webp").ok).toBe(true); // 1 × 1
  });

  it("acepta cada tipo de cabecera con sus dimensiones", () => {
    expect(inspeccionar(webp(), "image/webp")).toEqual({ ok: true });
    expect(inspeccionar(webp(2000, 3000, 2000), "image/webp")).toEqual({ ok: true });
    expect(inspeccionar(vp8(640, 480), "image/webp")).toEqual({ ok: true });
    expect(inspeccionar(vp8l(640, 480), "image/webp")).toEqual({ ok: true });
  });

  it("el tamaño de RIFF tiene que ser el del archivo: cortado o con datos de más es inválido", () => {
    expect(motivo(inspeccionar(cortar(webp(), 1), "image/webp"))).toBe("el WebP está cortado o tiene datos de más");
    expect(motivo(inspeccionar(Buffer.concat([webp(), Buffer.from("x")]), "image/webp"))).toBe("el WebP está cortado o tiene datos de más");
    expect(motivo(inspeccionar(webp().subarray(0, 19), "image/webp"))).toBe("el WebP está incompleto");
    expect(motivo(inspeccionar(riff(Buffer.from("VP8X")), "image/webp"))).toBe("el WebP está incompleto");
    expect(motivo(inspeccionar(riff(Buffer.concat([Buffer.from("VP8X"), Buffer.alloc(6)])), "image/webp"))).toBe("el WebP está incompleto");
    expect(motivo(inspeccionar(riff(Buffer.concat([Buffer.from("VP8 "), Buffer.alloc(5)])), "image/webp"))).toBe("el WebP está incompleto");
    expect(motivo(inspeccionar(riff(Buffer.concat([Buffer.from("VP8L"), Buffer.alloc(4)])), "image/webp"))).toBe("el WebP está incompleto");
  });

  it("un tipo de cabecera desconocido, o un cuadro con la firma dañada, es inválido", () => {
    const raro = Buffer.from(webp());
    raro.write("ABCD", 12);
    expect(motivo(inspeccionar(raro, "image/webp"))).toBe("el WebP no tiene un formato conocido");
    expect(motivo(inspeccionar(vp8(10, 10, [0x9d, 0x01, 0x2b]), "image/webp"))).toBe("el WebP tiene la cabecera de cuadro dañada");
    expect(motivo(inspeccionar(vp8(10, 10, [0x9c, 0x01, 0x2a]), "image/webp"))).toBe("el WebP tiene la cabecera de cuadro dañada");
    expect(motivo(inspeccionar(vp8(10, 10, [0x9d, 0x02, 0x2a]), "image/webp"))).toBe("el WebP tiene la cabecera de cuadro dañada");
    expect(motivo(inspeccionar(vp8l(10, 10, 0x2e), "image/webp"))).toBe("el WebP tiene la cabecera sin pérdida dañada");
  });

  it("dimensiones: cero inválido en cada tipo y topes justo en el borde", () => {
    expect(causa(inspeccionar(vp8(0, 10), "image/webp"))).toBe("invalido");
    expect(causa(inspeccionar(vp8(10, 0), "image/webp"))).toBe("invalido");
    expect(inspeccionar(vp8(MAX_LADO_PX, 4882), "image/webp").ok).toBe(true);
    expect(causa(inspeccionar(vp8(MAX_LADO_PX, 4883), "image/webp"))).toBe("dimensiones");
    expect(inspeccionar(vp8l(MAX_LADO_PX, 4882), "image/webp").ok).toBe(true);
    expect(causa(inspeccionar(vp8l(MAX_LADO_PX, 4883), "image/webp"))).toBe("dimensiones");
    expect(causa(inspeccionar(vp8l(MAX_LADO_PX + 1, 10), "image/webp"))).toBe("dimensiones");
    expect(inspeccionar(webp(100, MAX_LADO_PX, 4882), "image/webp").ok).toBe(true);
    expect(causa(inspeccionar(webp(100, MAX_LADO_PX, 4883), "image/webp"))).toBe("dimensiones");
    expect(causa(inspeccionar(webp(100, 16000000, 16000000), "image/webp"))).toBe("dimensiones");
    expect(causa(inspeccionar(webp(100, 100, 16000000), "image/webp"))).toBe("dimensiones");
  });

  it("en VP8 los dos bits altos del ancho y del alto son la escala, no parte de la medida", () => {
    expect(inspeccionar(vp8(10 | 0xc000, 10), "image/webp").ok).toBe(true);
    expect(inspeccionar(vp8(10, 10 | 0x4000), "image/webp").ok).toBe(true);
    expect(causa(inspeccionar(vp8(0x4000, 10), "image/webp"))).toBe("invalido");
  });

  it("el ancho y el alto de VP8L y de VP8X se leen de sus bits (no se confunden)", () => {
    expect(inspeccionar(vp8l(8192, 1), "image/webp").ok).toBe(true);
    expect(inspeccionar(vp8l(1, 8192), "image/webp").ok).toBe(true);
    expect(causa(inspeccionar(vp8l(8193, 1), "image/webp"))).toBe("dimensiones");
    expect(causa(inspeccionar(vp8l(1, 8193), "image/webp"))).toBe("dimensiones");
    expect(inspeccionar(webp(100, 1, 8192), "image/webp").ok).toBe(true);
    expect(causa(inspeccionar(webp(100, 1, 8193), "image/webp"))).toBe("dimensiones");
    expect(causa(inspeccionar(webp(100, 8193, 1), "image/webp"))).toBe("dimensiones");
  });
});

const doc = (cuerpo: string): Buffer => Buffer.from(`%PDF-1.7\n${cuerpo}\n%%EOF\n`, "latin1");

describe("PDF", () => {
  it("los largos justos: 15 bytes ya no es un PDF y 16 sí; el %%EOF cuenta hasta 1024 bytes antes del final", () => {
    expect(motivo(inspeccionar(Buffer.from("%PDF-1.7\n%%EOF\n"), "application/pdf"))).toBe("el PDF no empieza como debe");
    expect(inspeccionar(Buffer.from("%PDF-1.7\n%%EOF\n\n"), "application/pdf").ok).toBe(true);
    expect(inspeccionar(Buffer.from("%PDF-1.7\n%%EOF" + "x".repeat(1019)), "application/pdf").ok).toBe(true);
    expect(causa(inspeccionar(Buffer.from("%PDF-1.7\n%%EOF" + "x".repeat(1020)), "application/pdf"))).toBe("invalido");
  });

  it("los #xx de un nombre se deshacen también con letras mayúsculas en el hexadecimal", () => {
    for (const activo of ["/#4AS", "/#4AavaScript"]) {
      expect([activo, causa(inspeccionar(doc(`1 0 obj << /S ${activo} >> endobj`), "application/pdf"))]).toEqual([activo, "invalido"]);
    }
  });

  it("un nombre seguido de dígitos o letras no es uno de los peligrosos", () => {
    for (const inocente of ["/JS1", "/Launch2", "/GoToR9", "/XFA0"]) {
      expect([inocente, inspeccionar(doc(`1 0 obj << /X ${inocente} >> endobj`), "application/pdf").ok]).toEqual([inocente, true]);
    }
  });

  it("acepta uno completo, de las versiones 1 y 2", () => {
    expect(inspeccionar(pdf(), "application/pdf")).toEqual({ ok: true });
    expect(inspeccionar(Buffer.from("%PDF-2.0\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"), "application/pdf").ok).toBe(true);
    expect(inspeccionar(Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"), "application/pdf").ok).toBe(true);
  });

  it("sin la cabecera correcta o muy corto es inválido", () => {
    expect(motivo(inspeccionar(Buffer.from("%PDF-3.0\nxxxxxxxxxx\n%%EOF"), "application/pdf"))).toBe("el PDF no empieza como debe");
    expect(motivo(inspeccionar(Buffer.from("%PDF-1.x\nxxxxxxxxxx\n%%EOF"), "application/pdf"))).toBe("el PDF no empieza como debe");
    expect(motivo(inspeccionar(Buffer.from("%PDF-1.7\n%%EOF"), "application/pdf"))).toBe("el PDF no empieza como debe");
    expect(motivo(inspeccionar(Buffer.from("xx%PDF-1.7\nxxxxxxxxxx\n%%EOF"), "application/pdf"))).toBe("el PDF no empieza como debe");
  });

  it("sin %%EOF entre los últimos 1024 bytes está cortado", () => {
    expect(motivo(inspeccionar(Buffer.from("%PDF-1.7\n" + "x".repeat(100)), "application/pdf"))).toBe("el PDF está cortado (no termina como debe)");
    expect(inspeccionar(Buffer.from("%PDF-1.7\n%%EOF\n" + "x".repeat(1000)), "application/pdf").ok).toBe(true);
    expect(causa(inspeccionar(Buffer.from("%PDF-1.7\n%%EOF\n" + "x".repeat(1030)), "application/pdf"))).toBe("invalido");
  });

  it("rechaza el contenido activo, también escrito con #xx en el nombre", () => {
    for (const activo of ["/JavaScript", "/JS (app.alert(1))", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA", "/SubmitForm", "/ImportData", "/GoToE", "/GoToR", "/J#61vaScript", "/#4aS", "/Launc#68"]) {
      const r = inspeccionar(doc(`1 0 obj << /S ${activo} >> endobj`), "application/pdf");
      expect([activo, causa(r), motivo(r)]).toEqual([activo, "invalido", "el PDF tiene contenido activo"]);
    }
  });

  it("no confunde nombres parecidos ni la palabra suelta, ni #xx fuera de un nombre", () => {
    for (const inocente of ["/JSON", "/JavaScripts", "/Launched", "/Embedded", "/XFAB", "JavaScript sin barra", "/Jsx", "(texto con #41 y /Js1)"]) {
      expect([inocente, inspeccionar(doc(`1 0 obj << /Type /Catalog /X ${inocente} >> endobj`), "application/pdf").ok]).toEqual([inocente, true]);
    }
  });
});

describe("miniatura", () => {
  it("es un JPEG completo de hasta 1024 px de lado", () => {
    expect(inspeccionarMiniatura(jpeg(50, 256, 256))).toEqual({ ok: true });
    expect(inspeccionarMiniatura(jpeg(50, MAX_LADO_MINIATURA_PX, 1))).toEqual({ ok: true });
    expect(causa(inspeccionarMiniatura(jpeg(50, MAX_LADO_MINIATURA_PX + 1, 1)))).toBe("dimensiones");
    expect(causa(inspeccionarMiniatura(jpeg(50, 1, MAX_LADO_MINIATURA_PX + 1)))).toBe("dimensiones");
  });

  it("uno cortado o que no es JPEG es inválido", () => {
    expect(causa(inspeccionarMiniatura(cortar(jpeg(50), 2)))).toBe("invalido");
    expect(causa(inspeccionarMiniatura(png()))).toBe("invalido");
  });
});

describe("las ayudas de las pruebas", () => {
  it("los archivos de ejemplo tienen el tamaño pedido (o el mínimo posible) y CRC válido", () => {
    expect(jpeg(1000).length).toBe(1000);
    expect(png(1000).length).toBe(1000);
    expect(webp(1000).length).toBe(1000);
    expect(pdf(1000).length).toBe(1000);
    expect(u32be(0x01020304)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(crc32(Buffer.from("IEND"))).toBe(0xae426082);
  });
});
