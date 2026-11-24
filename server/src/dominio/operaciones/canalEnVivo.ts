// Canal en vivo: avisa a los dispositivos conectados de un viaje que hay novedades hasta una secuencia. Solo avisa:
// los cambios se bajan con el pull de siempre, así que perder un aviso no pierde datos.

export interface ReceptorDelCanal {
  /** Hay novedades hasta esta secuencia. */
  novedades(cabeza: number): void;
  /** El canal lo da de baja (reemplazado por otra conexión del mismo dispositivo, o apagado del servidor). */
  cerrar(): void;
}

export interface CanalEnVivo {
  /** Conecta a un dispositivo; devuelve la función que lo da de baja. Una conexión nueva del mismo dispositivo reemplaza a la vieja. */
  suscribir(tripId: string, deviceId: string, receptor: ReceptorDelCanal): () => void;
  /** Avisa a los dispositivos conectados de ese viaje. */
  notificar(tripId: string, cabeza: number): void;
  /** Cuántos dispositivos hay conectados. */
  conexiones(): number;
  /** Hay lugar para otra conexión (de ese dispositivo, que reemplaza a la suya si ya tiene una). */
  hayLugar(tripId: string, deviceId: string): boolean;
  /** Cierra la conexión de ese dispositivo, si la tiene (por ejemplo, porque lo revocaron). */
  expulsar(tripId: string, deviceId: string): void;
  /** Cierra todas las conexiones (apagado del servidor). */
  cerrarTodo(): void;
}

export const MAX_CONEXIONES = 64;

/** Un receptor que falla al cerrarse no puede impedir que se cierren los demás ni que entre una conexión nueva. */
function cerrarSinFallar(receptor: ReceptorDelCanal | undefined): void {
  try {
    receptor?.cerrar();
  } catch {
    /* se sigue igual */
  }
}

const clave = (tripId: string, deviceId: string): string => `${tripId}\u0000${deviceId}`;

export class CanalEnMemoria implements CanalEnVivo {
  private readonly receptores = new Map<string, { tripId: string; receptor: ReceptorDelCanal }>();

  constructor(private readonly maximo: number = MAX_CONEXIONES) {}

  hayLugar(tripId: string, deviceId: string): boolean {
    return this.receptores.has(clave(tripId, deviceId)) || this.receptores.size < this.maximo;
  }

  suscribir(tripId: string, deviceId: string, receptor: ReceptorDelCanal): () => void {
    const k = clave(tripId, deviceId);
    const anterior = this.receptores.get(k);
    this.receptores.delete(k);
    cerrarSinFallar(anterior?.receptor);
    const entrada = { tripId, receptor };
    this.receptores.set(k, entrada);
    // dar de baja una conexión ya reemplazada no toca a la nueva
    return () => {
      if (this.receptores.get(k) === entrada) this.receptores.delete(k);
    };
  }

  notificar(tripId: string, cabeza: number): void {
    for (const e of [...this.receptores.values()]) {
      if (e.tripId !== tripId) continue;
      try {
        e.receptor.novedades(cabeza);
      } catch {
        /* un receptor roto no puede frenar el aviso a los demás */
      }
    }
  }

  conexiones(): number {
    return this.receptores.size;
  }

  expulsar(tripId: string, deviceId: string): void {
    const k = clave(tripId, deviceId);
    const entrada = this.receptores.get(k);
    if (entrada === undefined) return;
    this.receptores.delete(k);
    cerrarSinFallar(entrada.receptor);
  }

  cerrarTodo(): void {
    const todos = [...this.receptores.values()];
    this.receptores.clear();
    for (const e of todos) cerrarSinFallar(e.receptor);
  }
}
