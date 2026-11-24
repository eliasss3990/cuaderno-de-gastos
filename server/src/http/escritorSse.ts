// Escritura de un canal SSE sobre un socket: avisos de novedades, latidos y control de `drain`. Con el socket lleno no se
// acumulan avisos (se guarda el último y se manda al vaciarse) y un cliente que no lee se corta tras unos latidos.

/** Lo que se usa de la respuesta cruda de Node. */
export interface SalidaSse {
  write(texto: string): unknown;
  end(): void;
  destroy(): void;
  readonly writableNeedDrain: boolean;
}

/** Tras terminar la respuesta, cuánto se espera a que el cliente la lea antes de destruir el socket (un cliente con el socket lleno no la termina). */
export const PLAZO_DE_CIERRE_MS = 2000;

/** Cuántos latidos seguidos con el socket sin vaciar se aguantan antes de cortarlo. */
export const LATIDOS_SIN_VACIAR = 3;

export const eventoDeNovedades = (cabeza: number): string => `id: ${cabeza}\nevent: novedades\ndata: {"head_seq":${cabeza}}\n\n`;

export class EscritorSse {
  private pendiente: number | null = null;
  private sinVaciar = 0;
  private cerrado = false;
  private plazo: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly salida: SalidaSse) {}

  /** Lo primero que ve el cliente: cuánto esperar para reconectar y la cabeza de ahora. */
  abrir(cabeza: number): void {
    this.escribir(`retry: 5000\n\n${eventoDeNovedades(cabeza)}`);
  }

  novedades(cabeza: number): void {
    if (this.salida.writableNeedDrain) this.pendiente = cabeza;
    else this.escribir(eventoDeNovedades(cabeza));
  }

  /** El socket se vació: se manda el último aviso que quedó esperando. */
  vaciada(): void {
    this.sinVaciar = 0;
    if (this.pendiente === null) return;
    const cabeza = this.pendiente;
    this.pendiente = null;
    this.novedades(cabeza);
  }

  /** Un comentario para que nadie corte una conexión sin novedades; con el socket lleno, cuenta hacia cortarla. */
  latido(): void {
    if (!this.salida.writableNeedDrain) {
      this.escribir(":\n\n");
      return;
    }
    this.sinVaciar += 1;
    if (this.sinVaciar >= LATIDOS_SIN_VACIAR && !this.cerrado) this.salida.destroy();
  }

  /** Termina la respuesta (apagado o conexión reemplazada). */
  cerrar(): void {
    if (this.cerrado) return;
    this.cerrado = true;
    this.salida.end();
    this.plazo = setTimeout(() => this.salida.destroy(), PLAZO_DE_CIERRE_MS);
    this.plazo.unref();
  }

  /** El socket ya se cerró por su cuenta: no se escribe más. */
  marcarCerrado(): void {
    this.cerrado = true;
    if (this.plazo !== null) clearTimeout(this.plazo);
    this.plazo = null;
  }

  private escribir(texto: string): void {
    if (!this.cerrado) this.salida.write(texto);
  }
}
