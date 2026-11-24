// Revisión de la estructura de un archivo, más allá de sus primeros bytes: que un JPEG, PNG, WebP o PDF esté completo y no
// sea una cáscara con la firma correcta, que las dimensiones de una imagen no sean una bomba de descompresión para el celular
// que la decodifique y que un PDF no traiga contenido activo. No decodifica nada (no hay biblioteca de imágenes): lee solo las
// cabeceras. Es una barrera razonable, no una garantía: un PDF con sus objetos comprimidos puede esconder lo que busca.

import { crc32 } from "node:zlib";
import type { Mime } from "./archivos.js";

/** Lado más largo de una imagen y cantidad de píxeles (la app sube unas 2000 × 1500 comprimidas). */
export const MAX_LADO_PX = 8192;
export const MAX_PIXELES = 40_000_000;
/** Lado más largo de una miniatura (la app genera miniaturas de unos 256 px). */
export const MAX_LADO_MINIATURA_PX = 1024;

export type Inspeccion =
  | { readonly ok: true }
  | { readonly ok: false; readonly causa: "invalido" | "dimensiones"; readonly motivo: string };

const bien: Inspeccion = { ok: true };
const roto = (motivo: string): Inspeccion => ({ ok: false, causa: "invalido", motivo });

const u16be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) * 0x1000000) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const u32le = (b: Uint8Array, i: number): number => ((b[i + 3] ?? 0) * 0x1000000) + (((b[i + 2] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i] ?? 0));
const texto = (b: Uint8Array, desde: number, largo: number): string => Buffer.from(b.subarray(desde, desde + largo)).toString("latin1");

/** Las dimensiones tienen que ser de una imagen real y no pasar de los topes. */
function conDimensiones(ancho: number, alto: number, ladoMaximo: number): Inspeccion {
  if (ancho < 1 || alto < 1) return roto("la imagen no tiene dimensiones");
  if (ancho > ladoMaximo || alto > ladoMaximo || ancho * alto > MAX_PIXELES) {
    return { ok: false, causa: "dimensiones", motivo: `la imagen es demasiado grande (${ancho} × ${alto})` };
  }
  return bien;
}

/** Los marcadores de inicio de cuadro (SOF) llevan el alto y el ancho; DHT (C4), JPG (C8) y DAC (CC) no. */
const esInicioDeCuadro = (marcador: number): boolean => marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;

function inspeccionarJpeg(b: Uint8Array, ladoMaximo: number): Inspeccion {
  if (b.length < 4 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return roto("el JPEG está cortado (no termina como debe)");
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return roto("el JPEG tiene un segmento inválido");
    const marcador = b[i + 1] ?? 0;
    if (marcador === 0xff) {
      i += 1; // relleno
      continue;
    }
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2; // marcadores sin longitud
      continue;
    }
    if (marcador === 0xd9 || marcador === 0xda) return roto("el JPEG no declara su tamaño");
    const largo = u16be(b, i + 2);
    if (largo < 2 || i + 2 + largo > b.length) return roto("el JPEG tiene un segmento cortado");
    if (esInicioDeCuadro(marcador)) {
      if (largo < 8) return roto("el JPEG tiene la cabecera de cuadro incompleta");
      return conDimensiones(u16be(b, i + 7), u16be(b, i + 5), ladoMaximo);
    }
    i += 2 + largo;
  }
  return roto("el JPEG no declara su tamaño");
}

/** Los últimos 12 bytes de todo PNG: un fragmento IEND vacío con su CRC. */
const FIN_DE_PNG = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function inspeccionarPng(b: Uint8Array, ladoMaximo: number): Inspeccion {
  if (b.length < 45) return roto("el PNG está incompleto");
  if (u32be(b, 8) !== 13 || texto(b, 12, 4) !== "IHDR") return roto("el PNG no empieza con su cabecera");
  if (crc32(b.subarray(12, 29)) !== u32be(b, 29)) return roto("la cabecera del PNG está dañada");
  if (!FIN_DE_PNG.every((byte, k) => b[b.length - 12 + k] === byte)) return roto("el PNG está cortado (no termina como debe)");
  return conDimensiones(u32be(b, 16), u32be(b, 20), ladoMaximo);
}

function inspeccionarWebp(b: Uint8Array, ladoMaximo: number): Inspeccion {
  if (b.length < 20) return roto("el WebP está incompleto");
  if (u32le(b, 4) + 8 !== b.length) return roto("el WebP está cortado o tiene datos de más");
  const tipo = texto(b, 12, 4);
  // cada cabecera necesita sus bytes de dimensiones: VP8 y VP8X hasta el 30, VP8L hasta el 25
  if (b.length < (tipo === "VP8L" ? 25 : 30)) return roto("el WebP está incompleto");
  switch (tipo) {
    case "VP8 ":
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return roto("el WebP tiene la cabecera de cuadro dañada");
      return conDimensiones(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff, ladoMaximo);
    case "VP8L": {
      if (b[20] !== 0x2f) return roto("el WebP tiene la cabecera sin pérdida dañada");
      const bits = u32le(b, 21);
      return conDimensiones((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, ladoMaximo);
    }
    case "VP8X":
      return conDimensiones(u24le(b, 24) + 1, u24le(b, 27) + 1, ladoMaximo);
    default:
      return roto("el WebP no tiene un formato conocido");
  }
}

/** Nombres de PDF que significan código o contenido incrustado: JavaScript, lanzar programas, adjuntos, formularios que envían datos. */
const CONTENIDO_ACTIVO = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData|GoToE|GoToR)(?![A-Za-z0-9])/;

function inspeccionarPdf(b: Uint8Array): Inspeccion {
  if (b.length < 16 || !/^%PDF-[12]\.\d/.test(texto(b, 0, 8))) return roto("el PDF no empieza como debe");
  if (!texto(b, Math.max(0, b.length - 1024), 1024).includes("%%EOF")) return roto("el PDF está cortado (no termina como debe)");
  // en un nombre de PDF cualquier letra puede escribirse como #xx: se deshace antes de buscar
  const normalizado = texto(b, 0, b.length).replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  if (CONTENIDO_ACTIVO.test(normalizado)) return roto("el PDF tiene contenido activo");
  return bien;
}

/** Revisa un archivo que ya se sabe del tipo `mime` (por sus primeros bytes). */
export function inspeccionar(bytes: Uint8Array, mime: Mime): Inspeccion {
  switch (mime) {
    case "image/jpeg":
      return inspeccionarJpeg(bytes, MAX_LADO_PX);
    case "image/png":
      return inspeccionarPng(bytes, MAX_LADO_PX);
    case "image/webp":
      return inspeccionarWebp(bytes, MAX_LADO_PX);
    case "application/pdf":
      return inspeccionarPdf(bytes);
  }
}

/** Una miniatura es siempre un JPEG chico. */
export function inspeccionarMiniatura(bytes: Uint8Array): Inspeccion {
  return inspeccionarJpeg(bytes, MAX_LADO_MINIATURA_PX);
}
