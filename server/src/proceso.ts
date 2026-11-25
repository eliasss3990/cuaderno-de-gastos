// Lo que hace el proceso cuando muere o recibe una señal: todo pasa por el registro y se sale con el código que corresponde.

import type { EventEmitter } from "node:events";
import type { Registro } from "./observabilidad/registro.js";

type Salir = (codigo: number) => void;
type Emisor = Pick<EventEmitter, "on">;

/** Registra el error fatal y sale con 1 (también si el propio registro falla). Devuelve esa función para reutilizarla. */
export function instalarErroresFatales(registro: Registro, salir: Salir = (c) => process.exit(c), emisor: Emisor = process): (evento: string, err: unknown) => void {
  const morir = (evento: string, err: unknown): void => {
    try {
      registro.error(evento, { err });
    } finally {
      salir(1);
    }
  };
  emisor.on("uncaughtException", (err) => morir("excepcion_no_capturada", err));
  emisor.on("unhandledRejection", (err) => morir("promesa_rechazada", err));
  return morir;
}

/**
 * Al recibir SIGTERM o SIGINT espera a que el arranque termine, detiene el servidor y sale con 0. Una señal repetida durante
 * el apagado se registra y se ignora; si el arranque falló no hay nada que detener (ya se está saliendo con 1).
 */
export function instalarApagado(
  registro: Registro,
  servidor: Promise<{ detener(): Promise<void> }>,
  morir: (evento: string, err: unknown) => void,
  salir: Salir = (c) => process.exit(c),
  emisor: Emisor = process,
): void {
  let apagando = false;
  const apagar = (senal: string): void => {
    if (apagando) return registro.warn("senal_repetida", { senal });
    apagando = true;
    registro.info("apagando", { senal });
    void servidor.then(
      (s) => s.detener().then(() => salir(0), (err: unknown) => morir("apagado_fallo", err)),
      () => undefined,
    );
  };
  emisor.on("SIGTERM", () => apagar("SIGTERM"));
  emisor.on("SIGINT", () => apagar("SIGINT"));
}
