// Sincronización de un viaje: subir un lote de operaciones, bajar las que otro dispositivo ya subió y conocer la cabeza
// (el último número de secuencia). Cada dispositivo solo toca el viaje al que pertenece (lo decide quien llama).

import { ErrorDeServicio } from "../identidad/servicioIdentidad.js";
import type { Almacen, Operacion, OpLeida } from "./operaciones.js";
import type { CanalEnVivo } from "./canalEnVivo.js";
import { LoteInvalidoError, RecepcionDeOperaciones, type ResultadoDeOperacion } from "./recepcion.js";

export const MAX_OPERACIONES_POR_PAGINA = 200;

export interface ActorDeSincronizacion {
  readonly tripId: string;
  readonly deviceId: string;
}

export interface PaginaDeCambios {
  readonly ops: readonly OpLeida[];
  /** Desde donde seguir: la secuencia de la última operación devuelta (o la pedida si no hubo ninguna). */
  readonly siguiente: number;
  readonly hayMas: boolean;
  readonly cabeza: number;
}

export interface DependenciasDeSincronizacion {
  readonly almacenDe: (tripId: string) => Almacen;
  /** Reloj del servidor (ms). */
  readonly ahora: () => number;
  /** Se avisa por acá cuando un lote deja operaciones nuevas. */
  readonly canal?: CanalEnVivo;
}

export class ServicioDeSincronizacion {
  constructor(private readonly dep: DependenciasDeSincronizacion) {}

  subir(actor: ActorDeSincronizacion, operaciones: readonly unknown[]): ResultadoDeOperacion[] {
    const almacen = this.dep.almacenDe(actor.tripId);
    const recepcion = new RecepcionDeOperaciones(almacen, this.dep.ahora);
    try {
      // lo que no tenga forma de operación lo rechaza la ingesta
      const resultados = recepcion.procesarLote(operaciones as readonly Operacion[], actor.deviceId);
      if (resultados.some((r) => r.estado === "accepted")) this.dep.canal?.notificar(actor.tripId, almacen.seqMaximo());
      return resultados;
    } catch (e) {
      if (e instanceof LoteInvalidoError) throw new ErrorDeServicio("formato_invalido", e.message);
      throw e;
    }
  }

  bajar(actor: ActorDeSincronizacion, despuesDe: number, limite: number): PaginaDeCambios {
    const tope = Math.min(Math.max(Math.trunc(limite), 1), MAX_OPERACIONES_POR_PAGINA);
    const almacen = this.dep.almacenDe(actor.tripId);
    const ops = almacen.leerOps(despuesDe, tope);
    const cabeza = almacen.seqMaximo();
    // un `after` mayor que la cabeza (cursor corrupto o servidor restaurado) no puede adelantar el cursor de la app
    const siguiente = ops.length === 0 ? Math.min(despuesDe, cabeza) : (ops[ops.length - 1] as OpLeida).seq;
    return { ops, siguiente, hayMas: cabeza > siguiente, cabeza };
  }

  cabeza(actor: ActorDeSincronizacion): number {
    return this.cabezaDelViaje(actor.tripId);
  }

  /** La cabeza de un viaje sin un dispositivo de por medio (para avisos internos del servidor). */
  cabezaDelViaje(tripId: string): number {
    return this.dep.almacenDe(tripId).seqMaximo();
  }
}
