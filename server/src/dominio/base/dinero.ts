// Dinero: siempre un entero en la unidad menor de la moneda (nunca un flotante).
// Formato: "." para los miles y "," para los decimales, en todas las monedas.
// El módulo no conoce ninguna moneda concreta: recibe sus datos (código, decimales y símbolo).

export interface Moneda {
  readonly codigo: string;
  readonly decimales: number;
  readonly simbolo: string;
}

/** Mayor monto representable en la unidad menor (entero seguro de JavaScript, también cabe en un Long). */
export const MAX_MONTO_MINOR = Number.MAX_SAFE_INTEGER;

export type ErrorMonto = "vacio" | "formato" | "decimales_de_mas" | "fuera_de_rango";

export type ResultadoParseo =
  | { readonly ok: true; readonly minor: number }
  | { readonly ok: false; readonly error: ErrorMonto };

/** Mayor cantidad de decimales que admite una moneda. */
export const MAX_DECIMALES = 4;

const MAX_BIG = BigInt(MAX_MONTO_MINOR);

function comprobarDecimales(decimales: number): void {
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > MAX_DECIMALES) {
    throw new RangeError(`los decimales deben ser un entero entre 0 y ${MAX_DECIMALES}, llegó ${decimales}`);
  }
}

function agrupar(enteros: string): string {
  return enteros.replaceAll(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function comprobarMinor(minor: number): void {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`el monto debe ser un entero seguro, llegó ${minor}`);
  }
}

/** Número sin símbolo: 123456 con 2 decimales -> "1.234,56". Un negativo lleva "-" delante. */
export function formatearNumero(minor: number, decimales: number): string {
  comprobarMinor(minor);
  comprobarDecimales(decimales);
  const digitos = String(Math.abs(minor)).padStart(decimales + 1, "0");
  const enteros = digitos.slice(0, digitos.length - decimales);
  const decimal = digitos.slice(digitos.length - decimales);
  return (minor < 0 ? "-" : "") + agrupar(enteros) + (decimales > 0 ? `,${decimal}` : "");
}

/** Monto con símbolo: "R$ 1.234,56", "₲ 1.234.567". Un negativo lleva "-" antes del símbolo. */
export function formatear(minor: number, moneda: Moneda): string {
  comprobarMinor(minor);
  const numero = formatearNumero(Math.abs(minor), moneda.decimales);
  return `${minor < 0 ? "-" : ""}${moneda.simbolo} ${numero}`;
}

const PATRON = /^(0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:\.[0-9]{3})+)(?:,([0-9]+))?$/;

/**
 * Lee un monto escrito como "1.234,56" (los puntos solo como separador de miles, en grupos de tres).
 * Acepta menos decimales de los que tiene la moneda ("12,9" en reales es 12,90); rechaza de más.
 * Un texto que termina en coma ("12,") todavía no es un monto: da `formato` (sí es válido mientras se escribe).
 */
export function parsear(texto: string, moneda: Moneda): ResultadoParseo {
  comprobarDecimales(moneda.decimales);
  if (texto === "") return { ok: false, error: "vacio" };
  const m = PATRON.exec(texto);
  if (m === null) return { ok: false, error: "formato" };
  const enteros = (m[1] ?? "").replaceAll(".", "");
  const decimal = m[2] ?? "";
  if (decimal.length > moneda.decimales) return { ok: false, error: "decimales_de_mas" };
  const valor = BigInt(enteros) * 10n ** BigInt(moneda.decimales) + BigInt(decimal.padEnd(moneda.decimales, "0") || "0");
  if (valor > MAX_BIG) return { ok: false, error: "fuera_de_rango" };
  return { ok: true, minor: Number(valor) };
}

function valorDe(enteros: string, decimal: string, decimales: number): bigint {
  return BigInt(enteros || "0") * 10n ** BigInt(decimales) + BigInt(decimal.padEnd(decimales, "0") || "0");
}

/**
 * Da formato al texto mientras se escribe. Recibe lo que hay en el campo (dígitos y a lo sumo una coma;
 * se ignora cualquier otro carácter) y devuelve el texto formateado. Quita ceros a la izquierda, descarta
 * decimales de más y, si el valor pasaría el máximo, descarta los últimos dígitos hasta que entre.
 * Los puntos se ignoran siempre (en pantalla solo aparecen como separador de miles): escribir "1.5" da "15".
 */
export function formatearEntrada(crudo: string, moneda: Moneda): string {
  comprobarDecimales(moneda.decimales);
  let enteros = "";
  let decimal = "";
  let hayComa = false;
  for (const c of crudo) {
    if (c >= "0" && c <= "9") {
      if (hayComa) decimal += c;
      else enteros += c;
    } else if (c === "," && moneda.decimales > 0 && !hayComa) {
      hayComa = true;
    }
  }
  enteros = enteros.replace(/^0+(?=\d)/, "");
  if (enteros === "" && !hayComa && decimal === "") return "";
  if (enteros === "") enteros = "0";
  decimal = decimal.slice(0, moneda.decimales);
  while (valorDe(enteros, decimal, moneda.decimales) > MAX_BIG) {
    if (decimal !== "") decimal = decimal.slice(0, -1);
    else enteros = enteros.slice(0, -1);
  }
  return agrupar(enteros) + (hayComa ? `,${decimal}` : "");
}

/** Cociente entero redondeado hacia abajo (hacia menos infinito). `b` debe ser un entero mayor que cero. */
export function dividirHaciaAbajo(a: number, b: number): number {
  comprobarMinor(a);
  if (!Number.isSafeInteger(b) || b < 1) {
    throw new RangeError(`el divisor debe ser un entero mayor que cero, llegó ${b}`);
  }
  const A = BigInt(a);
  const B = BigInt(b);
  let q = A / B;
  if (A % B !== 0n && A < 0n) q -= 1n;
  return Number(q);
}
