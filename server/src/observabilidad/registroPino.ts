// Registro sobre pino: una línea JSON por evento a la salida estándar (Docker se queda con las últimas por tamaño). El nombre
// del evento va en `evento`, junto a la hora (ISO), el nivel y el servicio. Es la única parte del servidor que conoce a pino.

import { pino, type DestinationStream, type Logger } from "pino";
import { limpiarCampos, limpiarError, OCULTO, type Campos, type Nivel, type Registro } from "./registro.js";

export interface OpcionesDelRegistro {
  /** `debug`, `info`, `warn`, `error` o `silent`; sin valor, `info`. Ver `leerNivel`. */
  readonly nivel?: Nivel | "silent";
  /** Dónde se escribe; sin valor, la salida estándar. Las pruebas pasan uno propio. */
  readonly destino?: DestinationStream;
}

export interface RegistroDePino extends Registro {
  /** La instancia de pino, para pasársela a Fastify (`loggerInstance`) y que sus propios mensajes salgan con el mismo formato. */
  readonly pino: Logger;
}

/** Claves que el registro escribe por su cuenta: un campo con ese nombre se renombra (`campo_evento`) para no duplicar la clave. */
const RESERVADAS = new Set(["evento", "servicio", "nivel", "time"]);

/**
 * Los campos limpios como un objeto común y sin claves reservadas. Es común (no sin prototipo) porque pino llama métodos de
 * `Object.prototype` sobre los campos de un hijo; `Object.fromEntries` define cada clave, también `__proto__`, como propia.
 */
const paraPino = (campos: Campos | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(limpiarCampos(campos)).map(([k, v]) => [RESERVADAS.has(k) ? `campo_${k}` : k, v]));

/** Cabeceras que pino oculta aunque algo las escriba sin pasar por `limpiarCampos` (segunda defensa, para los logs de Fastify). */
const CABECERAS = ["authorization", '["x-token"]', '["x-api-key"]', '["proxy-authorization"]', "cookie", '["set-cookie"]'];
const REDACTAR = ["req.headers", "res.headers", "headers"].flatMap((base) => CABECERAS.map((c) => (c.startsWith("[") ? `${base}${c}` : `${base}.${c}`)));

class Envoltorio implements Registro {
  constructor(readonly pino: Logger) {}

  private escribir(nivel: Nivel, evento: string, campos: Campos | undefined): void {
    if (!this.pino.isLevelEnabled(nivel)) return; // con el nivel apagado no se gasta en limpiar lo que no se escribe
    this.pino[nivel](paraPino(campos), evento);
  }

  debug(evento: string, campos?: Campos): void { this.escribir("debug", evento, campos); }
  info(evento: string, campos?: Campos): void { this.escribir("info", evento, campos); }
  warn(evento: string, campos?: Campos): void { this.escribir("warn", evento, campos); }
  error(evento: string, campos?: Campos): void { this.escribir("error", evento, campos); }
  hijo(campos: Campos): RegistroDePino { return new Envoltorio(this.pino.child(paraPino(campos))); }
}

export function crearRegistroPino(opciones: OpcionesDelRegistro = {}): RegistroDePino {
  const config = {
    level: opciones.nivel ?? "info",
    messageKey: "evento",
    base: { servicio: "cuaderno-server" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (etiqueta: string) => ({ nivel: etiqueta }) },
    // un error real (el que escribe Fastify) sale como `{ type, message, stack }`, igual que los que pasan por `limpiarCampos`
    serializers: { err: (e: unknown) => (e instanceof Error ? limpiarError(e) : e) },
    redact: { paths: REDACTAR, censor: OCULTO },
  };
  return new Envoltorio(opciones.destino === undefined ? pino(config) : pino(config, opciones.destino));
}
