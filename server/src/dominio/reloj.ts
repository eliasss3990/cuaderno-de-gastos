// Reloj híbrido: una marca (milisegundos, contador, dispositivo) que ordena las ediciones aunque los
// relojes de los celulares no coincidan. Como texto de largo fijo, comparar el texto es comparar el reloj:
//   "{ms:013x}-{contador:04x}-{dispositivo}"   (hexadecimal en minúsculas; el dispositivo es un UUID en minúsculas)
// El módulo es puro: nunca lee la hora, la recibe como argumento.

export interface Hlc {
  readonly ms: number;
  readonly contador: number;
  readonly dispositivo: string;
}

/** Mayor valor de milisegundos que entra en 13 dígitos hexadecimales. */
export const MAX_MS = 0xfffffffffffff;
/** Mayor valor del contador (4 dígitos hexadecimales). */
export const MAX_CONTADOR = 0xffff;
/** Una marca más de este tiempo en el futuro respecto del reloj del servidor se corrige. */
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATRON = new RegExp(`^([0-9a-f]{13})-([0-9a-f]{4})-(${UUID})$`);
const PATRON_UUID = new RegExp(`^${UUID}$`);

export type ResultadoHlc =
  | { readonly ok: true; readonly hlc: Hlc }
  | { readonly ok: false; readonly error: "formato" };

function entero(valor: number, max: number, nombre: string): void {
  if (!Number.isSafeInteger(valor) || Object.is(valor, -0) || valor < 0 || valor > max) {
    throw new RangeError(`${nombre} debe ser un entero entre 0 y ${max}, llegó ${valor}`);
  }
}

function dispositivoValido(dispositivo: string): void {
  if (!PATRON_UUID.test(dispositivo)) {
    throw new RangeError(`el dispositivo debe ser un UUID en minúsculas, llegó '${dispositivo}'`);
  }
}

export function formatearHlc(h: Hlc): string {
  entero(h.ms, MAX_MS, "los milisegundos");
  entero(h.contador, MAX_CONTADOR, "el contador");
  dispositivoValido(h.dispositivo);
  return `${h.ms.toString(16).padStart(13, "0")}-${h.contador.toString(16).padStart(4, "0")}-${h.dispositivo}`;
}

export function parsearHlc(texto: string): ResultadoHlc {
  const m = PATRON.exec(texto);
  if (m === null) return { ok: false, error: "formato" };
  return {
    ok: true,
    hlc: {
      ms: Number.parseInt(m[1] ?? "", 16),
      contador: Number.parseInt(m[2] ?? "", 16),
      dispositivo: m[3] ?? "",
    },
  };
}

function validar(h: Hlc): void {
  entero(h.ms, MAX_MS, "los milisegundos");
  entero(h.contador, MAX_CONTADOR, "el contador");
  dispositivoValido(h.dispositivo);
}

/**
 * Orden total: primero milisegundos, luego contador, luego el dispositivo (como texto). Devuelve -1, 0 o 1.
 * Es el mismo orden que el del texto formateado. Lanza un error si alguna marca no es válida.
 */
export function compararHlc(a: Hlc, b: Hlc): -1 | 0 | 1 {
  validar(a);
  validar(b);
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  if (a.contador !== b.contador) return a.contador < b.contador ? -1 : 1;
  if (a.dispositivo !== b.dispositivo) return a.dispositivo < b.dispositivo ? -1 : 1;
  return 0;
}

/**
 * Regla de recibir: la marca que hay que tomar como "última" después de ver una marca de otro dispositivo
 * es la mayor entre la propia y la remota (por milisegundos y contador, sin mirar el dispositivo). Se aplica
 * a cada operación que llega de otro celular; la próxima marca propia se genera con `siguienteHlc` a partir
 * de ese resultado, así una edición hecha después de ver otra siempre queda ordenada después, aunque el
 * reloj local esté atrasado.
 *
 * Importante: no acota la marca remota. Solo se deben observar marcas ya corregidas por el servidor (que
 * nunca están más de cinco minutos en el futuro); observar una marca absurda dejaría al dispositivo anclado
 * en ese futuro, o sin poder emitir marcas si llegara al máximo.
 */
export function observarHlc(
  ultimo: { readonly ms: number; readonly contador: number } | null,
  remota: { readonly ms: number; readonly contador: number },
): { readonly ms: number; readonly contador: number } {
  entero(remota.ms, MAX_MS, "los milisegundos de la marca remota");
  entero(remota.contador, MAX_CONTADOR, "el contador de la marca remota");
  if (ultimo === null) return { ms: remota.ms, contador: remota.contador };
  entero(ultimo.ms, MAX_MS, "los milisegundos de la última marca");
  entero(ultimo.contador, MAX_CONTADOR, "el contador de la última marca");
  const remotaMayor = remota.ms > ultimo.ms || (remota.ms === ultimo.ms && remota.contador > ultimo.contador);
  const mayor = remotaMayor ? remota : ultimo;
  return { ms: mayor.ms, contador: mayor.contador };
}

/**
 * Marca siguiente de este dispositivo. Usa la hora del reloj pero nunca retrocede: si el reloj atrasó o
 * se repite el milisegundo, sube el contador; si el contador se desborda, avanza un milisegundo.
 */
export function siguienteHlc(
  ultimo: { readonly ms: number; readonly contador: number } | null,
  ahoraMs: number,
  dispositivo: string,
): Hlc {
  entero(ahoraMs, MAX_MS, "la hora");
  dispositivoValido(dispositivo);
  let ms = ahoraMs;
  let contador = 0;
  if (ultimo !== null) {
    entero(ultimo.ms, MAX_MS, "los milisegundos de la última marca");
    entero(ultimo.contador, MAX_CONTADOR, "el contador de la última marca");
    if (ultimo.ms >= ahoraMs) {
      ms = ultimo.ms;
      contador = ultimo.contador + 1;
    }
  }
  if (contador > MAX_CONTADOR) {
    ms += 1;
    contador = 0;
  }
  entero(ms, MAX_MS, "los milisegundos de la marca nueva");
  return { ms, contador, dispositivo };
}

export interface MarcaCorregida {
  readonly hlc: Hlc;
  readonly corregida: boolean;
}

/**
 * Si la marca está más de cinco minutos en el futuro respecto de la hora del servidor, la reemplaza por la
 * hora del servidor (mismo dispositivo). No rechaza por estar en el futuro, para no perder datos; con una
 * marca o una hora inválidas sí lanza un error. Una marca a cinco minutos o menos no se toca (un celular con
 * el reloj adelantado menos que eso puede ganar empates de "gana el último").
 *
 * `ultimoDelDispositivo` es la mayor marca ya guardada de ese dispositivo (o null). La marca corregida se
 * genera a partir de ella con `siguienteHlc`, así nunca queda repetida ni antes de una marca anterior del
 * mismo dispositivo. El celular debe reescribir su marca con la devuelta y recalcular su última marca a partir
 * de ella; si no, seguiría en el futuro y todas sus marcas se corregirían. El parámetro es obligatorio a
 * propósito (pasar null si el dispositivo no tiene marcas guardadas): omitirlo haría colapsar marcas distintas.
 * Si la mayor marca guardada está lejos en el futuro (por ejemplo porque el reloj del servidor retrocedió),
 * la marca corregida queda por encima de ella y también por encima de la tolerancia: la monotonía manda.
 */
export function corregirMarcaFutura(
  h: Hlc,
  ahoraServidorMs: number,
  ultimoDelDispositivo: { readonly ms: number; readonly contador: number } | null,
): MarcaCorregida {
  entero(ahoraServidorMs, MAX_MS, "la hora del servidor");
  validar(h);
  if (ultimoDelDispositivo !== null) {
    entero(ultimoDelDispositivo.ms, MAX_MS, "los milisegundos de la última marca del dispositivo");
    entero(ultimoDelDispositivo.contador, MAX_CONTADOR, "el contador de la última marca del dispositivo");
  }
  if (h.ms <= ahoraServidorMs + TOLERANCIA_FUTURO_MS) return { hlc: h, corregida: false };
  return { hlc: siguienteHlc(ultimoDelDispositivo, ahoraServidorMs, h.dispositivo), corregida: true };
}

/** Desfase del celular: hora del servidor menos hora del celular. */
export function aprenderDesfase(servidorMs: number, localMs: number): number {
  entero(servidorMs, MAX_MS, "la hora del servidor");
  entero(localMs, MAX_MS, "la hora del celular");
  return servidorMs - localMs;
}

/**
 * Hora del celular corregida con el desfase aprendido, acotada entre 0 y el máximo. Es la hora que se debe
 * pasar a `siguienteHlc` (no la hora cruda del reloj del celular).
 */
export function ahoraCorregida(localMs: number, desfaseMs: number): number {
  entero(localMs, MAX_MS, "la hora del celular");
  if (!Number.isSafeInteger(desfaseMs)) throw new RangeError(`el desfase debe ser un entero, llegó ${desfaseMs}`);
  return Math.min(MAX_MS, Math.max(0, localMs + desfaseMs));
}
