import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

const u16be = (n: number): Buffer => Buffer.from([(n >>> 8) & 0xff, n & 0xff]);
const u32be = (n: number): Buffer => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const u16le = (n: number): Buffer => Buffer.from([n & 0xff, (n >>> 8) & 0xff]);
const u24le = (n: number): Buffer => Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff]);
const u32le = (n: number): Buffer => Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/**
 * Archivos de ejemplo con la estructura mínima que revisa el servidor, rellenados hasta `n` bytes. Una imagen declara su
 * `ancho` y `alto` (100 × 100 por defecto).
 */
export function jpeg(n = 100, ancho = 100, alto = 100): Buffer {
  const cuadro = Buffer.concat([Buffer.from([0xff, 0xc0]), u16be(11), Buffer.from([8]), u16be(alto), u16be(ancho), Buffer.from([1, 1, 0x11, 0])]);
  const cabecera = Buffer.concat([Buffer.from([0xff, 0xd8]), cuadro, Buffer.from([0xff, 0xda]), u16be(8), Buffer.from([1, 1, 0, 0, 0x3f, 0])]);
  return Buffer.concat([cabecera, Buffer.alloc(Math.max(n, cabecera.length + 2) - cabecera.length - 2, 7), Buffer.from([0xff, 0xd9])]);
}

export function png(n = 100, ancho = 100, alto = 100): Buffer {
  const ihdr = Buffer.concat([Buffer.from("IHDR"), u32be(ancho), u32be(alto), Buffer.from([8, 2, 0, 0, 0])]);
  const base = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32be(13), ihdr, u32be(crc32(ihdr))]);
  const fin = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const relleno = Math.max(n - base.length - fin.length - 12, 0);
  return Buffer.concat([base, u32be(relleno), Buffer.from("IDAT"), Buffer.alloc(relleno, 7), u32be(0), fin]);
}

/** WebP con cabecera extendida (VP8X): el tamaño de RIFF coincide con el del archivo. */
export function webp(n = 100, ancho = 100, alto = 100): Buffer {
  const vp8x = Buffer.concat([Buffer.from("VP8X"), u32le(10), Buffer.from([0, 0, 0, 0]), u24le(ancho - 1), u24le(alto - 1)]);
  const relleno = Math.max(n - 12 - vp8x.length - 8, 0);
  const cuerpo = Buffer.concat([Buffer.from("WEBP"), vp8x, Buffer.from("JUNK"), u32le(relleno), Buffer.alloc(relleno, 7)]);
  return Buffer.concat([Buffer.from("RIFF"), u32le(cuerpo.length), cuerpo]);
}

export function pdf(n = 100): Buffer {
  const principio = Buffer.from("%PDF-1.7\n");
  const fin = Buffer.from("\n%%EOF\n");
  return Buffer.concat([principio, Buffer.alloc(Math.max(n, principio.length + fin.length) - principio.length - fin.length, 0x20), fin]);
}

export { u16be, u16le, u24le, u32be, u32le };

export const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

export type Mime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
