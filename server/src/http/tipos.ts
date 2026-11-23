// Lo que los hooks de la API agregan a cada pedido de Fastify.

import type { Dispositivo } from "../dominio/identidad/identidad.js";
import type { Registro } from "../observabilidad/registro.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Registro del pedido: lleva `req_id` y, ya autenticado, `trip_id` y `device_id` abreviados. */
    registro: Registro;
    /** El dispositivo autenticado; null en las rutas sin token. */
    dispositivo: Dispositivo | null;
    /** `performance.now()` al empezar el pedido. */
    inicio: number;
    /** El código de error con el que se respondió, para el registro del pedido. */
    codigoDeError: string | null;
  }
}
