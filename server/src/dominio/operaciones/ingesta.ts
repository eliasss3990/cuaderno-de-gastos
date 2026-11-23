// Ingesta de una operación recibida: formato, duplicado, cierre del viaje, estado y, si todo está bien, aplicarla.
// Todo ocurre dentro de una sola transacción del almacén. El duplicado va antes que el estado: un reintento de algo ya
// aceptado debe devolver `duplicate` aunque ahora el estado ya no lo admitiría (por ejemplo, un límite).

import { MotorOperaciones, type Almacen, type Operacion, type Resultado } from "./operaciones.js";
import { dentroDeUnCierre, horaDeCreacion, sincronizarCierre } from "./cierreViaje.js";
import { validarOperacion } from "./validacion.js";
import { validarContraEstado } from "./validacionEstado.js";

export class Ingesta {
  private readonly motor: MotorOperaciones;

  /**
   * `ahora` es el reloj del servidor (ms): el estado del viaje por fechas depende de él. Precondición: las marcas de
   * las operaciones ya pasaron por la corrección de marcas futuras (si no, un `trip.update` con una hora adelantada
   * abriría un cierre en el futuro que nadie podría reabrir).
   */
  constructor(private readonly almacen: Almacen, private readonly ahora: () => number = Date.now) {
    this.motor = new MotorOperaciones(almacen);
  }

  procesar(op: Operacion): Resultado {
    if ((op as unknown) === null || typeof op !== "object") return { estado: "rejected", razon: "formato" };
    return this.almacen.transaccion(() => {
      if (!validarOperacion(op).ok) return { estado: "rejected", razon: "formato" };
      if (this.almacen.opConocida(op.opId)) return { estado: "duplicate" };
      // si el viaje ya terminó por fechas y nadie lo había anotado, se abre el intervalo antes de juzgar
      sincronizarCierre(this.almacen, this.ahora(), null);
      if (op.tipo !== "trip.update" && !this.almacen.entidadTerminada(op.entidadTipo, op.entidadId) && dentroDeUnCierre(this.almacen.intervalosDeCierre(), horaDeCreacion(op))) {
        return { estado: "rejected", razon: "viaje_cerrado" };
      }
      const razon = validarContraEstado(op, this.almacen);
      if (razon !== null) return { estado: "rejected", razon };
      const resultado = this.motor.aplicar(op);
      if (resultado.estado === "accepted" && (op.tipo === "trip.create" || op.tipo === "trip.update")) {
        sincronizarCierre(this.almacen, this.ahora(), horaDeCreacion(op));
      }
      return resultado;
    });
  }
}
