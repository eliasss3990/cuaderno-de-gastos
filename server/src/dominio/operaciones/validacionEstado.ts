// Validación de una operación contra el estado del viaje: referencias (la moneda debe ser una del viaje y la
// categoría debe existir), límites (adjuntos activos por dueño y cantidad de atajos) y que la edición de un
// movimiento de efectivo corresponda a su tipo. Es de solo lectura: devuelve la razón del rechazo o null.
// Va después de la validación de formato y de comprobar que no es un duplicado, y dentro de la misma
// transacción que aplica la operación (si no, dos operaciones a la vez podrían pasar el mismo límite).

import type { Almacen, Operacion, Razon } from "./operaciones.js";
import { DINERO_DEL_MOVIMIENTO } from "./validacion.js";

export const MAX_ADJUNTOS_ACTIVOS = 3;
export const MAX_ATAJOS = 6;

export type LecturaDelEstado = Pick<Almacen, "entidadExiste" | "entidadTerminada" | "leerCampo" | "leerReloj" | "adjuntosDe" | "contarEntidades">;

const CAMPOS_DE_MONEDA = ["moneda", "moneda_sale", "moneda_entra", "moneda_ajuste"] as const;

/**
 * Razón por la que el estado no admite la operación, o null si la admite. Una operación sobre algo ya terminado
 * no se mira: el motor la acepta redactada y no cambia nada. (Un adjunto de un dueño terminado no necesita un caso
 * aparte: el dueño ya no tiene adjuntos que contar y el adjunto no trae monedas ni categorías.)
 */
export function validarContraEstado(op: Operacion, estado: LecturaDelEstado): Razon | null {
  const { entidadTipo: tipo, entidadId: id, payload: p } = op;
  if (estado.entidadTerminada(tipo, id)) return null;

  for (const campo of CAMPOS_DE_MONEDA) {
    const moneda = p[campo];
    if (typeof moneda === "string" && !estado.entidadExiste("trip_currency", moneda)) return "moneda_no_habilitada";
  }
  const categoria = p.categoria_id;
  if (typeof categoria === "string" && !estado.entidadExiste("category", categoria)) return "entidad_inexistente";

  if (op.tipo === "attachment.add") {
    // el propio adjunto no cuenta: repetir su alta no agrega uno más
    const activos = estado
      .adjuntosDe(String(p.owner_id))
      .filter((adjunto) => adjunto !== id && estado.leerCampo("attachment", adjunto, "quitado") !== 1);
    if (activos.length >= MAX_ADJUNTOS_ACTIVOS) return "limite_superado";
  }
  if (op.tipo === "shortcut.create" && !estado.entidadExiste("shortcut", id) && estado.contarEntidades("shortcut") >= MAX_ATAJOS) {
    return "limite_superado";
  }

  if (op.tipo === "cashmove.update") {
    const tipoDelMovimiento = estado.leerCampo("cash_movement", id, "tipo");
    if (typeof tipoDelMovimiento === "string") {
      const dinero = DINERO_DEL_MOVIMIENTO[tipoDelMovimiento] ?? [];
      if (Object.keys(p).some((campo) => campo !== "cuando" && campo !== "nota" && !dinero.includes(campo))) return "formato";
      if (tipoDelMovimiento === "CAMBIO") {
        // Se mira lo que quedaría tras resolver los relojes: una edición solo cambia el campo si su marca es mayor
        // que la guardada. Con el valor que trae la operación a secas, una de las dos monedas podría perder contra
        // una edición más nueva y las dos quedarían iguales.
        const quedaria = (campo: string) => {
          const nuevo = p[campo];
          const reloj = estado.leerReloj("cash_movement", id, campo);
          return nuevo !== undefined && (reloj === null || op.hlc > reloj) ? nuevo : estado.leerCampo("cash_movement", id, campo);
        };
        if (quedaria("moneda_sale") === quedaria("moneda_entra")) return "formato";
      }
    }
  }
  return null;
}
