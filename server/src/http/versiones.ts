// Comparación de versiones de la app (`X-App-Version` contra `APP_MIN_VERSION`): hasta 4 números separados por puntos.

const FORMA = /^(\d{1,6}(?:\.\d{1,6}){0,3})(?:[-+][\w.-]{1,30})?$/;

/** Los números de una versión (`"0.1.1-debug"` da `[0, 1, 1]`), o null si no tiene esa forma. */
export function parsearVersion(texto: unknown): number[] | null {
  const m = typeof texto === "string" ? FORMA.exec(texto.trim()) : null;
  return m === null ? null : (m[1] as string).split(".").map(Number);
}

/** -1, 0 o 1 según `a` sea menor, igual o mayor que `b` (los números que faltan valen 0). */
export function compararVersiones(a: readonly number[], b: readonly number[]): -1 | 0 | 1 {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
