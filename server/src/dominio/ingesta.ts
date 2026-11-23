// Ingesta de una operación recibida: formato, duplicado, estado y, si todo está bien, aplicarla. Todo ocurre
// dentro de una sola transacción del almacén. El duplicado va antes que el estado: un reintento de algo ya
// aceptado debe devolver `duplicate` aunque ahora el estado ya no lo admitiría (por ejemplo, un límite).

import { MotorOperaciones, type Almacen, type Operacion, type Resultado } from "./operaciones.js";
import { validarOperacion } from "./validacion.js";
import { validarContraEstado } from "./validacionEstado.js";

export class Ingesta {
  private readonly motor: MotorOperaciones;

  constructor(private readonly almacen: Almacen) {
    this.motor = new MotorOperaciones(almacen);
  }

  procesar(op: Operacion): Resultado {
    if ((op as unknown) === null || typeof op !== "object") return { estado: "rejected", razon: "formato" };
    return this.almacen.transaccion(() => {
      if (!validarOperacion(op).ok) return { estado: "rejected", razon: "formato" };
      if (this.almacen.opConocida(op.opId)) return { estado: "duplicate" };
      const razon = validarContraEstado(op, this.almacen);
      if (razon !== null) return { estado: "rejected", razon };
      return this.motor.aplicar(op);
    });
  }
}
