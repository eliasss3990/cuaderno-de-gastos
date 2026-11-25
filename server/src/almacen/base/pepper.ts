// Detecta un cambio de pepper: la base guarda una huella del pepper con el que se crearon sus códigos y huellas de IP.

import type { Database } from "better-sqlite3";
import { huellaDeVerificacionDelPepper } from "../../dominio/identidad/credenciales.js";

const CLAVE = "huella_del_pepper";

export type ComprobacionDelPepper =
  | { readonly estado: "registrado" | "coincide" }
  | { readonly estado: "distinto" }
  | { readonly estado: "reemplazado"; readonly invitacionesBorradas: number; readonly intentosBorrados: number };

/** Compara sin escribir nada: para quien no debe registrar ni reemplazar la huella (la administración). */
export function pepperDeLaBase(db: Database, pepper: Uint8Array): "coincide" | "distinto" | "sin_huella" {
  const fila = db.prepare("SELECT valor FROM servidor_parametro WHERE clave = ?").get(CLAVE) as { valor: string } | undefined;
  if (fila === undefined) return "sin_huella";
  return fila.valor === huellaDeVerificacionDelPepper(pepper) ? "coincide" : "distinto";
}

/**
 * Compara el pepper con la huella guardada. Sin huella, la registra; si no coincide, devuelve `distinto` salvo que se acepte
 * el nuevo: entonces borra las invitaciones sin usar y los intentos de unirse (sus huellas ya no sirven) y guarda la nueva.
 */
export function comprobarElPepper(db: Database, pepper: Uint8Array, aceptarNuevo: boolean): ComprobacionDelPepper {
  const huella = huellaDeVerificacionDelPepper(pepper);
  return db.transaction((): ComprobacionDelPepper => {
    const fila = db.prepare("SELECT valor FROM servidor_parametro WHERE clave = ?").get(CLAVE) as { valor: string } | undefined;
    if (fila === undefined) {
      db.prepare("INSERT INTO servidor_parametro (clave, valor) VALUES (?, ?)").run(CLAVE, huella);
      return { estado: "registrado" };
    }
    if (fila.valor === huella) return { estado: "coincide" };
    if (!aceptarNuevo) return { estado: "distinto" };
    const invitacionesBorradas = db.prepare("DELETE FROM invitation WHERE usada_en IS NULL").run().changes;
    const intentosBorrados = db.prepare("DELETE FROM join_attempt").run().changes;
    db.prepare("UPDATE servidor_parametro SET valor = ? WHERE clave = ?").run(huella, CLAVE);
    return { estado: "reemplazado", invitacionesBorradas, intentosBorrados };
  }).immediate();
}
