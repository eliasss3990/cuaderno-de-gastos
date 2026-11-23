// Cierre del viaje por intervalos. Una operación se juzga por su hora de creación (la de su marca), no por cuándo
// llega: si cae dentro de un intervalo cerrado se rechaza (salvo `trip.update`, que es la forma de reabrir) y si
// cae fuera se acepta aunque llegue después. Los intervalos solo los toca este módulo, y siempre dentro de la
// transacción de la ingesta.

import type { Almacen, IntervaloCierre, Operacion } from "./operaciones.js";
import { cierrePorFechas, estadoDelViaje, type PlanDelViaje } from "../base/estadoViaje.js";
import { parsearHlc } from "../base/reloj.js";

export type LecturaDelViaje = Pick<Almacen, "idDelViaje" | "leerCampo" | "intervalosDeCierre" | "abrirIntervalo" | "cerrarIntervalo">;

export function dentroDeUnCierre(intervalos: readonly IntervaloCierre[], ms: number): boolean {
  return intervalos.some((i) => ms >= i.desdeMs && (i.hastaMs === null || ms < i.hastaMs));
}

function planDelViaje(almacen: LecturaDelViaje, id: string): PlanDelViaje | null {
  const zona = almacen.leerCampo("trip", id, "zona_horaria");
  if (typeof zona !== "string") return null;
  const texto = (campo: string): string | null => {
    const valor = almacen.leerCampo("trip", id, campo);
    return typeof valor === "string" ? valor : null;
  };
  const manual = texto("estado_manual");
  return { 
    estadoManual: manual === "EN_CURSO" || manual === "CERRADO" 
      ? manual 
      : null, 
    fechaInicio: texto("fecha_inicio"), 
    fechaFin: texto("fecha_fin"), 
    zonaHoraria: zona 
  };
}

/**
 * Hace que los intervalos reflejen el estado actual del viaje. `momentoMs` es la hora de creación de la operación
 * que acaba de cambiar el plan, o null si nadie lo cambió (el viaje terminó solo por fechas). Si está cerrado y no
 * hay intervalo abierto, abre uno: manual desde `momentoMs`; por fechas desde que terminó el día de fin, o desde
 * `momentoMs` si fue un cambio posterior (por ejemplo borrar el estado manual): lo creado mientras el viaje estuvo
 * abierto a mano no se rechaza. Si no está cerrado y hay uno abierto, lo cierra en `momentoMs`. Un intervalo
 * abierto no cambia de causa mientras el viaje siga cerrado, y un intervalo abierto solo lo cierra una operación.
 */
export function sincronizarCierre(almacen: LecturaDelViaje, ahoraMs: number, momentoMs: number | null): void {
  const id = almacen.idDelViaje();
  if (id === null) return;
  const plan = planDelViaje(almacen, id);
  if (plan === null) return;
  const intervalos = almacen.intervalosDeCierre();
  const abierto = intervalos[intervalos.length - 1];
  const hayAbierto = abierto !== undefined && abierto.hastaMs === null;
  const cerrado = estadoDelViaje(plan, ahoraMs) === "CERRADO";
  if (cerrado && !hayAbierto) {
    const finDelAnterior = abierto?.hastaMs ?? 0;
    const manual = plan.estadoManual === "CERRADO";
    const inicio = manual ? (momentoMs ?? ahoraMs) : Math.max(cierrePorFechas(plan) as number, momentoMs ?? 0);
    almacen.abrirIntervalo(Math.max(inicio, finDelAnterior), manual ? "MANUAL" : "FECHAS");
  } else if (!cerrado && hayAbierto && momentoMs !== null) {
    // solo una operación que cambia el plan reabre; si nadie lo cambió y el reloj del servidor retrocedió, el cierre sigue
    almacen.cerrarIntervalo(Math.max(momentoMs, abierto.desdeMs + 1));
  }
}

/** Hora de creación de la operación (milisegundos de su marca). */
export function horaDeCreacion(op: Operacion): number {
  const h = parsearHlc(op.hlc);
  return h.ok ? h.hlc.ms : 0;
}
