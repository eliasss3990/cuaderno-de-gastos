// Estado del viaje: no se guarda ni se sincroniza, se deriva en cada lugar con esta misma función pura.
// Manual si existe; si no, por fechas y zona horaria del viaje: planificado antes de las 00:00 de la fecha de
// inicio (o sin fecha de inicio), en curso desde ahí, cerrado al terminar el día de la fecha de fin (sin fecha de
// fin nunca se cierra solo).

export type EstadoViaje = "PLANIFICADO" | "EN_CURSO" | "CERRADO";

export interface PlanDelViaje {
  readonly estadoManual: "EN_CURSO" | "CERRADO" | null;
  readonly fechaInicio: string | null;
  readonly fechaFin: string | null;
  readonly zonaHoraria: string;
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reloj local de la zona en `ms`, expresado como si fuera UTC: la diferencia con `ms` es el desfase de la zona. */
const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateadorDe(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formateadores.set(zona, f);
  }
  return f;
}

function relojLocalComoUtc(ms: number, zona: string): number {
  const partes = formateadorDe(zona).formatToParts(new Date(ms));
  const v = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
}

const desfase = (ms: number, zona: string): number => relojLocalComoUtc(ms, zona) - ms;
const DIA_MS = 86_400_000;

/**
 * Primer instante (ms epoch UTC) en que el reloj de la zona marca `fecha` 00:00. Si esa hora no existe (el
 * horario de verano salta a medianoche), el primer instante de ese día que sí existe.
 */
export function inicioDelDia(fecha: string, zona: string): number {
  const m = FECHA.exec(fecha);
  if (m === null) throw new RangeError(`fecha inválida: ${fecha}`);
  const local = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const validos = new Set<number>();
  for (const referencia of [local - DIA_MS, local + DIA_MS]) {
    const candidato = local - desfase(referencia, zona);
    if (relojLocalComoUtc(candidato, zona) === local) validos.add(candidato);
  }
  if (validos.size > 0) return Math.min(...validos);
  return local - desfase(local - DIA_MS, zona); // hueco: la transición, con el desfase de antes de saltar
}

export function diaSiguiente(fecha: string): string {
  const m = FECHA.exec(fecha);
  if (m === null) throw new RangeError(`fecha inválida: ${fecha}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

/** Instante en que el viaje pasa a cerrado por fechas (al terminar el día de la fecha de fin), o null. */
export function cierrePorFechas(plan: Pick<PlanDelViaje, "fechaFin" | "zonaHoraria">): number | null {
  return plan.fechaFin === null ? null : inicioDelDia(diaSiguiente(plan.fechaFin), plan.zonaHoraria);
}

export function estadoDelViaje(plan: PlanDelViaje, ahoraMs: number): EstadoViaje {
  if (plan.estadoManual !== null) return plan.estadoManual;
  const cierre = cierrePorFechas(plan);
  if (cierre !== null && ahoraMs >= cierre) return "CERRADO";
  if (plan.fechaInicio !== null && ahoraMs >= inicioDelDia(plan.fechaInicio, plan.zonaHoraria)) return "EN_CURSO";
  return "PLANIFICADO";
}
