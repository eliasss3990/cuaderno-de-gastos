import { limpiarCampos, type Campos, type Nivel, type Registro } from "../../src/observabilidad/registro.js";

export interface Entrada {
  readonly nivel: Nivel;
  readonly evento: string;
  readonly campos: Record<string, unknown>;
}

/** Un registro que guarda lo que se escribe, para comprobarlo en las pruebas. Aplica la misma limpieza que el de producción. */
export class RegistroDeMemoria implements Registro {
  constructor(
    readonly entradas: Entrada[] = [],
    private readonly base: Record<string, unknown> = {},
  ) {}

  private escribir(nivel: Nivel, evento: string, campos?: Campos): void {
    this.entradas.push({ nivel, evento, campos: { ...this.base, ...limpiarCampos(campos) } });
  }

  debug(evento: string, campos?: Campos): void { this.escribir("debug", evento, campos); }
  info(evento: string, campos?: Campos): void { this.escribir("info", evento, campos); }
  warn(evento: string, campos?: Campos): void { this.escribir("warn", evento, campos); }
  error(evento: string, campos?: Campos): void { this.escribir("error", evento, campos); }
  hijo(campos: Campos): RegistroDeMemoria { return new RegistroDeMemoria(this.entradas, { ...this.base, ...limpiarCampos(campos) }); }
}
