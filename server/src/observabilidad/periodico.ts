// Una tarea que se repite cada tanto sin retener al proceso: la usan el resumen de métricas y el mantenimiento.

export interface OpcionesPeriodicas {
  readonly cadaMs: number;
  /** Para pruebas: reemplazan a `setInterval` y `clearInterval`. */
  readonly programar?: (accion: () => void, cadaMs: number) => unknown;
  readonly cancelar?: (temporizador: unknown) => void;
}

/** Ejecuta `accion` cada `cadaMs` y devuelve la función que la detiene. La acción no debe lanzar: nadie recoge su error. */
export function tareaPeriodica(accion: () => void, opciones: OpcionesPeriodicas): () => void {
  const { cadaMs } = opciones;
  if (!Number.isFinite(cadaMs) || cadaMs <= 0) throw new RangeError("el intervalo debe ser un número positivo");
  const programar = opciones.programar ?? ((a, ms) => setInterval(a, ms));
  const cancelar = opciones.cancelar ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));
  const temporizador = programar(accion, cadaMs);
  // una tarea de mantenimiento no debe impedir que el proceso termine
  if (typeof temporizador === "object" && temporizador !== null && "unref" in temporizador && typeof temporizador.unref === "function") temporizador.unref();
  return () => cancelar(temporizador);
}
