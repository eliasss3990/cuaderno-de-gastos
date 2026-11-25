// Credenciales del servidor: tokens de dispositivo, códigos de invitación, huellas y los UUID v7 que genera el servidor.
// Todo es puro salvo la fuente de azar, que se inyecta (por defecto, la del sistema). El token y el código nunca se
// guardan: solo su huella. Cada uso de la huella lleva su propio prefijo, para que el mismo texto no dé la misma huella en
// dos usos distintos (separación de dominios).

import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

/** Fuente de bytes aleatorios; en las pruebas se reemplaza por una determinista. */
export type Aleatorio = (cantidad: number) => Uint8Array;

export const aleatorioDelSistema: Aleatorio = (cantidad) => randomBytes(cantidad);

/** Letras y dígitos sin ambigüedades (sin 0, 1, I, L ni O): 31 símbolos. */
export const ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const LARGO_CODIGO = 8;
const BYTES_DEL_TOKEN = 32; // 256 bits
const BYTES_MINIMOS_DEL_PEPPER = 32;
/** Múltiplo de 31 más grande que cabe en un byte: los bytes desde acá se descartan para que no haya sesgo. */
const LIMITE_SIN_SESGO = 248; // 31 * 8
const MAX_SORTEOS_DEL_CODIGO = 64;

/** Pide `cantidad` bytes a la fuente de azar y comprueba que lo que vuelve sea de verdad eso (un doble de prueba mal escrito no debe pasar). */
function bytesDe(aleatorio: Aleatorio, cantidad: number): Uint8Array {
  const bytes = aleatorio(cantidad);
  if (!(bytes instanceof Uint8Array) || bytes.length !== cantidad) throw new RangeError(`la fuente de azar debía dar ${cantidad} bytes (Uint8Array)`);
  return bytes;
}

/** Un token de dispositivo nuevo: 256 bits aleatorios en base64url (43 caracteres). */
export function generarToken(aleatorio: Aleatorio = aleatorioDelSistema): string {
  return Buffer.from(bytesDe(aleatorio, BYTES_DEL_TOKEN)).toString("base64url");
}

/** Huella del token (SHA-256 del texto, en hexadecimal minúscula): es lo único que se guarda. */
export function huellaDeToken(token: string): string {
  if (typeof token !== "string" || token === "") throw new RangeError("el token debe ser un texto no vacío");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Un código de invitación nuevo: 8 caracteres del alfabeto, sorteados sin sesgo por rechazo. */
export function generarCodigo(aleatorio: Aleatorio = aleatorioDelSistema): string {
  let codigo = "";
  for (let sorteo = 0; sorteo < MAX_SORTEOS_DEL_CODIGO && codigo.length < LARGO_CODIGO; sorteo++) {
    for (const byte of bytesDe(aleatorio, 16)) {
      if (byte >= LIMITE_SIN_SESGO) continue;
      codigo += ALFABETO_CODIGO[byte % ALFABETO_CODIGO.length];
      if (codigo.length === LARGO_CODIGO) break;
    }
  }
  if (codigo.length !== LARGO_CODIGO) throw new Error("la fuente de azar no dio bytes suficientes para el código");
  return codigo;
}

/**
 * Lleva lo que escribió una persona a la forma del código: sin separadores y en mayúsculas. Los separadores son lo que la
 * clase `\s` de JavaScript considera espacio (espacios, tabuladores, saltos de línea, el espacio duro y los de otros
 * alfabetos, el BOM U+FEFF y los separadores de línea y de párrafo U+2028 y U+2029: todo eso se cuela al copiar de un chat)
 * y los guiones (el de unión U+2010, el corto, el largo, la raya y el signo menos U+2212, que el teclado del celular pone
 * solos): se quitan y no se convierten en nada. Un carácter invisible que no es separador (espacio de ancho cero U+200B,
 * unión de palabras U+2060, guion suave U+00AD…) se rechaza. Devuelve null si
 * no tiene la forma de un código (largo y alfabeto), sin intentar adivinar: tampoco acepta letras que no sean ASCII, porque
 * pasar a mayúsculas puede convertir una letra en otras distintas ("ß" en "SS").
 */
export function normalizarCodigo(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const sinSeparadores = texto.replaceAll(/[\s\u2010-\u2015\u2212-]/g, "");
  if (/[^\x00-\x7f]/.test(sinSeparadores)) return null;
  const limpio = sinSeparadores.toUpperCase();
  if (limpio.length !== LARGO_CODIGO) return null;
  for (const c of limpio) if (!ALFABETO_CODIGO.includes(c)) return null;
  return limpio;
}

/**
 * El *pepper*: el contenido del archivo secreto (por ejemplo la salida de `openssl rand -hex 32`, que son 64 caracteres)
 * sin espacios ni saltos de línea alrededor, usado tal cual como clave. Se exigen al menos 32 bytes.
 */
export function leerPepper(contenido: string): Uint8Array {
  if (typeof contenido !== "string") throw new RangeError("el pepper debe ser un texto");
  const bytes = Buffer.from(contenido.trim(), "utf8");
  if (bytes.length < BYTES_MINIMOS_DEL_PEPPER) throw new RangeError(`el pepper debe tener al menos ${BYTES_MINIMOS_DEL_PEPPER} bytes`);
  return bytes;
}

function hmac(pepper: Uint8Array, dominio: string, texto: string): string {
  if (!(pepper instanceof Uint8Array) || pepper.length < BYTES_MINIMOS_DEL_PEPPER) throw new RangeError(`el pepper debe ser un Uint8Array de al menos ${BYTES_MINIMOS_DEL_PEPPER} bytes`);
  return createHmac("sha256", pepper).update(`${dominio}:${texto}`, "utf8").digest("hex");
}

/** Huella fija del pepper (HMAC con un dominio propio): se guarda en la base para notar que el pepper cambió, sin revelarlo. */
export function huellaDeVerificacionDelPepper(pepper: Uint8Array): string {
  return hmac(pepper, "verificacion", "cuaderno-de-gastos");
}

/** Huella del código ya normalizado (HMAC-SHA256 con el pepper): es lo único que se guarda. */
export function huellaDeCodigo(codigoNormalizado: string, pepper: Uint8Array): string {
  if (normalizarCodigo(codigoNormalizado) !== codigoNormalizado) throw new RangeError("el código debe estar normalizado");
  return hmac(pepper, "codigo", codigoNormalizado);
}

function gruposDeIpv6(v6: string): number[] {
  let texto = v6;
  const ultimo = texto.lastIndexOf(":");
  const cola = texto.slice(ultimo + 1);
  if (cola.includes(".")) {
    const o = cola.split(".").map(Number) as [number, number, number, number];
    texto = `${texto.slice(0, ultimo + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [izquierda = "", derecha] = texto.includes("::") ? texto.split("::") : [texto, undefined];
  const a = izquierda ? izquierda.split(":") : [];
  const b = derecha ? derecha.split(":") : [];
  const relleno = 8 - a.length - b.length; // sin "::" ya hay 8 grupos y no se rellena nada
  return [...a, ...Array<string>(relleno).fill("0"), ...b].map((g) => parseInt(g, 16));
}

/**
 * La parte de la IP que identifica a quien llama, para limitar intentos: una IPv4 es ella misma; una IPv6 mapeada a IPv4
 * (`::ffff:a.b.c.d`) es esa IPv4; cualquier otra IPv6 es su prefijo de 64 bits (un hogar recibe un /64 entero: sin esto, otra
 * forma de escribir la misma dirección, otra mayúscula u otra dirección del mismo /64 esquivarían el límite). Se ignora la
 * zona (`%eth0`) y los espacios de alrededor. Lanza un error si no es una IP.
 */
export function claveDeRed(ip: string): string {
  if (typeof ip !== "string") throw new RangeError("la IP debe ser un texto");
  const texto = ip.trim();
  if (isIPv4(texto)) return texto;
  const sinZona = texto.split("%")[0] as string;
  if (!isIPv6(sinZona)) throw new RangeError("no es una dirección IP");
  const g = gruposDeIpv6(sinZona);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${(g[6] as number) >> 8}.${(g[6] as number) & 255}.${(g[7] as number) >> 8}.${(g[7] as number) & 255}`;
  return `${g.slice(0, 4).map((x) => x.toString(16).padStart(4, "0")).join(":")}/64`;
}

/** Huella de la IP, ya reducida a su clave de red (HMAC-SHA256 con el pepper): la IP en claro no se guarda. */
export function huellaDeIp(ip: string, pepper: Uint8Array): string {
  return hmac(pepper, "ip", claveDeRed(ip));
}

const MAX_MS_UUID = 2 ** 48 - 1;

/** UUID v7: 48 bits de milisegundos, versión 7, variante 10 y el resto aleatorio; en minúsculas. */
export function uuidV7(ahoraMs: number, aleatorio: Aleatorio = aleatorioDelSistema): string {
  if (!Number.isSafeInteger(ahoraMs) || ahoraMs < 0 || ahoraMs > MAX_MS_UUID) throw new RangeError(`la hora debe ser un entero entre 0 y ${MAX_MS_UUID}, llegó ${String(ahoraMs)}`);
  const azar = bytesDe(aleatorio, 10);
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(ahoraMs, 0, 6);
  Buffer.from(azar).copy(bytes, 6);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
