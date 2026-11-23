// Interfaz de registro (logs) del servidor: el resto del código depende de ella y no de la herramienta (hoy pino, en
// registroPino.ts). Un evento tiene un nombre fijo en minúsculas con guiones bajos (`ops_recibidas`) y campos con los datos.
// `limpiarCampos` oculta por NOMBRE (credenciales, contenido de operaciones, montos, notas, coordenadas) y por FORMA en los
// textos (`Bearer ...`, `token=...`, un token). Un dato del usuario con otro nombre dentro de un texto libre no se reconoce.

export type Nivel = "debug" | "info" | "warn" | "error";
export type Campos = Readonly<Record<string, unknown>>;

export interface Registro {
  debug(evento: string, campos?: Campos): void;
  info(evento: string, campos?: Campos): void;
  warn(evento: string, campos?: Campos): void;
  error(evento: string, campos?: Campos): void;
  /** Un registro que agrega esos campos a todo lo que escriba (por ejemplo `trip_id` y `device_id` abreviados). */
  hijo(campos: Campos): Registro;
}

/** Registro que no escribe nada: para pruebas y para quien no recibe uno. */
export const registroNulo: Registro = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  hijo: () => registroNulo,
};

export const OCULTO = "[oculto]";

const LIMPIOS = new WeakSet<object>();
/** Marca un objeto que el propio código controla y ya validó (las métricas): `limpiarCampos` lo deja pasar tal cual. */
export function marcarLimpio<T extends object>(objeto: T): T {
  LIMPIOS.add(objeto);
  return objeto;
}
const MAX_PROFUNDIDAD = 6;
const MAX_LARGO_DEL_TEXTO = 1000;
const MAX_ELEMENTOS = 100;

/**
 * Nombres de campo que nunca se escriben, sin mayúsculas ni separadores (`X-Token` y `x_token` son el mismo), hasta 6 niveles
 * de profundidad: contenido de operaciones, textos libres, datos personales, del gasto y de la base, y claves cortas.
 * Ocultar de más es preferible: es mejor registrar un dato pensado (`cantidad`, `motivo`) que un objeto entero.
 */
const PROHIBIDOS = new Set([
  "payload", "body", "cuerpo", "data", "datos", "pepper", "clave", "pass", "pwd", "contrasena", "key", "salt", "sig", "otp", "pin", "auth",
  "amount", "valor", "value", "monto", "importe", "price", "precio", "cost", "costo", "gasto", "gastos", "expense", "expenses",
  "descripcion", "description", "nota", "notas", "note", "notes", "email", "correo", "telefono", "phone",
  "location", "ubicacion", "coords", "coordinates", "gps", "lat", "lng", "lon", "latitud", "longitud", "latitude", "longitude",
  "bindings", "values", "rows", "content",
  "passphrase", "mnemonic", "seed", "hmac", "nonce", "cvv", "iban", "dni", "totp", "cred", "creds", "ciphertext", "authheader", "xauth",
  "url", "href", "link", "sharelink", "uri", "dsn", "connectionstring", // usá `ruta` con `rutaSinConsulta`
]);

/** Credenciales y códigos: se oculta todo nombre que las contenga (`tokenHash`, `x-api-key`, `Set-Cookie`, `inviteCode`, `privateKey`). */
const SENSIBLE = /token|secret|passw|cookie|authoriz|apikey|bearer|jwt|session|credential|invit|privatekey|signature/;
/** Un código: el nombre empieza por `codigo` o termina en `code` (`codigo_viaje`, `joinCode`). */
const CODIGO = /^codigo|code$/;

const normalizar = (nombre: string): string => nombre.toLowerCase().replace(/[^a-z0-9]/g, "");
const esSensible = (nombre: string): boolean => {
  const n = normalizar(nombre);
  return PROHIBIDOS.has(n) || SENSIBLE.test(n) || CODIGO.test(n);
};

/**
 * Palabras que delatan un valor secreto en un texto. Se buscan sin prefijo comodín (sería cuadrático con textos largos) y con
 * sufijos acotados: `user_token=x` coincide desde `token`, y `invite_code=x` desde `invit`.
 */
const CLAVES = "token|secret|pass|pwd|code|codigo|invit\\w{0,30}|key|sig(?:nature)?|otp|pin|auth|bearer|session(?:_?id)?";
const BEARER = /\bbearer\s+[\w.~+/=-]+/gi;
const PARAMETRO = new RegExp(`((?:${CLAVES})[\\w-]{0,40})(\\s{0,5}(?:[=:]|%3D)\\s{0,5})(?:"(?:[^"\\\\]|\\\\.){0,200}"|'(?:[^'\\\\]|\\\\.){0,200}'|"[^\\r\\n]*|'[^\\r\\n]*|[^&;,\\s"'#]+)`, "gi");
const CAMPO_JSON = new RegExp(`(["'][\\w-]{0,40}(?:${CLAVES})[\\w-]{0,40}["']\\s{0,5}:\\s{0,5})("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\[[^\\]]{0,500}\\]|\\{[^}]{0,500}\\}|[^\\s,}\\]"']+)`, "gi");
const USUARIO_Y_CLAVE = /(:\/\/[^\s:@/]{0,60}:)[^\s@/]{1,100}@/g;
const COOKIE = /(cookie\s*:\s*)[^\r\n]+/gi;
const AUTORIZACION = /(authorization\s*:\s*)[^\r\n]+/gi;
const JWT = /(?<![\w-])eyJ[\w-]{5,}\.[\w-]+\.[\w-]*/g;
/** Un token de dispositivo: 256 bits en base64url son exactamente 43 caracteres. */
const FORMA_DE_TOKEN = /(?<![\w-])[\w-]{43}(?![\w-])/g;

/** Oculta en un texto lo que se reconoce por su forma. No inspecciona el significado: ver el encabezado. */
function ocultarEnTexto(entrada: string): string {
  let texto = entrada;
  // un texto que es todo un JSON se analiza de verdad: sus claves se juzgan por nombre, a cualquier profundidad
  if (texto.length <= 20000 && /^\s*[[{]/.test(texto)) {
    try {
      texto = JSON.stringify(limpiarValor(JSON.parse(texto), 0, new Set()));
    } catch {
      /* no es JSON: sigue con las formas */
    }
  }
  return texto
    .replace(COOKIE, `$1${OCULTO}`)
    .replace(AUTORIZACION, `$1${OCULTO}`)
    .replace(USUARIO_Y_CLAVE, `$1${OCULTO}@`)
    .replace(CAMPO_JSON, `$1"${OCULTO}"`)
    .replace(BEARER, `Bearer ${OCULTO}`)
    .replace(PARAMETRO, `$1$2${OCULTO}`)
    .replace(JWT, OCULTO)
    .replace(FORMA_DE_TOKEN, OCULTO);
}

const CORRIDA_LARGA = /[\w-]{32,}/;
const MUCHOS_DIGITOS = /(?:\d[.:/-]?){9,}/;
const CABECERA_DE_JWT = /eyJ[\w-]{5,}\./;

/**
 * Si un texto parece un dato y no una etiqueta o un nombre: una corrida de 32 o más caracteres de `[\w-]` (un token, un
 * sha256, un UUID, un base64), 9 o más dígitos (un teléfono, aunque los separen puntos o guiones) o el comienzo de un JWT.
 */
export function pareceUnDato(texto: string): boolean {
  return CORRIDA_LARGA.test(texto) || MUCHOS_DIGITOS.test(texto) || CABECERA_DE_JWT.test(texto);
}

/** Un texto del log: con lo reconocible oculto y cortado a `MAX_LARGO_DEL_TEXTO` caracteres. */
function cortar(texto: string): string {
  return texto.length > MAX_LARGO_DEL_TEXTO ? `${texto.slice(0, MAX_LARGO_DEL_TEXTO)}…[${texto.length - MAX_LARGO_DEL_TEXTO} más]` : texto;
}

/** La ruta de una URL sin los parámetros ni el fragmento (`/join?code=X` → `/join`): para registrar pedidos sin sus datos. */
export function rutaSinConsulta(url: unknown): string {
  return typeof url === "string" ? (url.split(/[?#]/, 1)[0] as string) : "";
}

/** Un error como `{ type, message, stack }` (más `code` si es un identificador corto, `cause` y `errors`): no copia otras propiedades. */
export function limpiarError(e: Error, profundidad = 0, vistos: Set<object> = new Set()): Record<string, unknown> {
  try {
    vistos.add(e);
    const salida: Record<string, unknown> = { type: limpiarValor(String(e.name), 0, vistos), message: limpiarValor(String(e.message), 0, vistos), stack: limpiarValor(e.stack, 0, vistos) };
    const codigo = (e as { code?: unknown }).code;
    if (typeof codigo === "string" && /^[\w.-]{1,64}$/.test(codigo)) salida.code = limpiarValor(codigo, 0, vistos);
    const causa = (e as { cause?: unknown }).cause;
    if (causa !== undefined) salida.cause = limpiarValor(causa, profundidad + 1, vistos);
    if (e instanceof AggregateError) salida.errors = limpiarValor(e.errors, profundidad + 1, vistos);
    return salida;
  } catch {
    return { type: "Error", message: "[ilegible]" };
  } finally {
    vistos.delete(e);
  }
}

function limpiarValor(valor: unknown, profundidad: number, vistos: Set<object>): unknown {
  if (valor === null || valor === undefined) return valor;
  switch (typeof valor) {
    case "string":
      return cortar(ocultarEnTexto(valor));
    case "number":
    case "boolean":
      return valor;
    case "bigint":
      return valor.toString();
    case "symbol":
    case "function":
      return `[${typeof valor}]`;
  }
  const objeto = valor as object;
  if (LIMPIOS.has(objeto)) return valor;
  if (valor instanceof String) return limpiarValor(valor.valueOf(), profundidad, vistos);
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? "[fecha inválida]" : valor.toISOString();
  if (ArrayBuffer.isView(valor) || valor instanceof ArrayBuffer) return `[binario ${valor.byteLength} bytes]`;
  if (valor instanceof Map || valor instanceof Set) return `[${valor instanceof Map ? "Map" : "Set"} ${valor.size}]`;
  if (vistos.has(objeto)) return "[circular]";
  if (profundidad >= MAX_PROFUNDIDAD) return "[demasiado profundo]";
  vistos.add(objeto);
  try {
    if (valor instanceof Error) return limpiarError(valor, profundidad + 1, vistos);
    if (Array.isArray(valor)) {
      const salida = valor.slice(0, MAX_ELEMENTOS).map((x) => limpiarValor(x, profundidad + 1, vistos));
      if (valor.length > MAX_ELEMENTOS) salida.push(`[${valor.length - MAX_ELEMENTOS} más]`);
      return salida;
    }
    return limpiarObjeto(objeto as Record<string, unknown>, profundidad + 1, vistos);
  } finally {
    vistos.delete(objeto);
  }
}

function limpiarObjeto(origen: Record<string, unknown>, profundidad: number, vistos: Set<object>): Record<string, unknown> {
  const salida: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let n = 0;
  for (const nombre of Object.keys(origen)) {
    if (n++ >= MAX_ELEMENTOS) {
      salida["[más]"] = true;
      break;
    }
    let valor: unknown;
    try {
      valor = origen[nombre];
    } catch {
      valor = "[ilegible]"; // un getter que lanza no debe tumbar el log
    }
    salida[cortar(ocultarEnTexto(nombre))] = esSensible(nombre) ? OCULTO : limpiarValor(valor, profundidad, vistos);
  }
  return salida;
}

/**
 * Copia de los campos lista para escribir: oculta los nombres prohibidos en cualquier nivel, corta textos y listas largas,
 * resuelve referencias circulares y errores, y nunca lanza. No modifica lo que recibe.
 */
export function limpiarCampos(campos: Campos | undefined): Record<string, unknown> {
  if (campos === undefined || campos === null || typeof campos !== "object") return {};
  try {
    return limpiarObjeto(campos as Record<string, unknown>, 0, new Set());
  } catch {
    return { campos: "[ilegibles]" };
  }
}

/** Los primeros 8 caracteres de un identificador: alcanza para seguir un viaje o un dispositivo en un log sin escribirlo entero. */
export function abreviarId(id: unknown): string {
  return typeof id === "string" ? id.slice(0, 8) : "";
}

const NIVELES: ReadonlySet<string> = new Set(["debug", "info", "warn", "error", "silent"]);

/**
 * El nivel desde `LOG_LEVEL`: `debug`, `info`, `warn`, `error` o `silent`; sin valor, `info`. Un valor que no es ninguno falla
 * al arrancar (un error de escritura no debe dejar el servidor sin logs sin que nadie se entere).
 */
export function leerNivel(valor: string | undefined): Nivel | "silent" {
  if (valor === undefined || valor.trim() === "") return "info";
  const nivel = valor.trim().toLowerCase();
  if (!NIVELES.has(nivel)) throw new RangeError(`LOG_LEVEL inválido: "${valor}" (usar debug, info, warn, error o silent)`);
  return nivel as Nivel | "silent";
}
