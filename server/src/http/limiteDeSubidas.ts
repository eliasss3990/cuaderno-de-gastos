// Cuántas subidas de archivos se atienden a la vez. Cada una retiene su cuerpo entero en memoria (hasta 10 MB): con pocas a la
// vez el contenedor no se queda sin memoria. Las demás esperan su turno en una cola corta, con el cuerpo todavía en el socket.

/** La cola está llena o se terminó el plazo de espera: hay que reintentar más tarde. */
export class SinLugarParaSubir extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SinLugarParaSubir";
  }
}

/** El cliente se fue mientras esperaba su turno. */
export class SubidaCancelada extends Error {
  constructor() {
    super("el cliente cerró la conexión mientras esperaba");
    this.name = "SubidaCancelada";
  }
}

export const MAX_SUBIDAS_SIMULTANEAS = 2;
export const MAX_SUBIDAS_EN_ESPERA = 8;
export const ESPERA_MAXIMA_DE_SUBIDA_MS = 30_000;

export class LimiteDeSubidas {
  private enCurso = 0;
  private readonly cola: { dar: () => void }[] = [];

  constructor(
    private readonly maximo: number = MAX_SUBIDAS_SIMULTANEAS,
    private readonly maxEnEspera: number = MAX_SUBIDAS_EN_ESPERA,
  ) {}

  get ocupados(): number {
    return this.enCurso;
  }

  get enEspera(): number {
    return this.cola.length;
  }

  /**
   * Pide un lugar. Devuelve la función que lo libera (se puede llamar más de una vez: libera una sola). Falla con
   * `SinLugarParaSubir` si la cola está llena o vence el plazo, y con `SubidaCancelada` si la señal se aborta antes del turno.
   */
  pedir(plazoMs: number, senal: AbortSignal): Promise<() => void> {
    if (senal.aborted) return Promise.reject(new SubidaCancelada());
    if (this.enCurso < this.maximo) {
      this.enCurso += 1;
      return Promise.resolve(this.liberador());
    }
    if (this.cola.length >= this.maxEnEspera) return Promise.reject(new SinLugarParaSubir("hay demasiadas subidas esperando"));
    return new Promise((ok, mal) => {
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      const turno = {
        dar: () => {
          dejarDeEsperar();
          this.enCurso += 1;
          ok(this.liberador());
        },
      };
      const salirDeLaCola = (): void => {
        dejarDeEsperar();
        const i = this.cola.indexOf(turno);
        if (i >= 0) this.cola.splice(i, 1);
      };
      const alCancelar = (): void => {
        salirDeLaCola();
        mal(new SubidaCancelada());
      };
      const dejarDeEsperar = (): void => {
        clearTimeout(temporizador);
        senal.removeEventListener("abort", alCancelar);
      };
      temporizador = setTimeout(() => {
        salirDeLaCola();
        mal(new SinLugarParaSubir("se terminó el plazo de espera"));
      }, plazoMs);
      senal.addEventListener("abort", alCancelar, { once: true });
      this.cola.push(turno);
    });
  }

  private liberador(): () => void {
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      this.enCurso -= 1;
      this.cola.shift()?.dar();
    };
  }
}
