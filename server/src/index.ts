import { arrancar } from "./arranque.js";
import { leerConfiguracion } from "./configuracion.js";
import { leerNivel } from "./observabilidad/registro.js";
import { crearRegistroPino } from "./observabilidad/registroPino.js";
import { instalarApagado, instalarErroresFatales } from "./proceso.js";

// Todo lo que sale del proceso pasa por el registro (JSON, con los datos sensibles ocultos), también cuando muere.
// Si LOG_LEVEL no es válido todavía no hay configuración: se usa info para poder decirlo.
const nivel = (() => {
  try {
    return leerNivel(process.env.LOG_LEVEL);
  } catch {
    return "info" as const;
  }
})();
const registro = crearRegistroPino({ nivel });

const morir = instalarErroresFatales(registro);
const arranque = Promise.resolve().then(() => arrancar(leerConfiguracion(process.env), { registro }));
instalarApagado(registro, arranque, morir); // antes de esperar el arranque: una señal que llegue mientras tanto también se atiende
arranque.catch((err: unknown) => morir("arranque_fallo", err));
