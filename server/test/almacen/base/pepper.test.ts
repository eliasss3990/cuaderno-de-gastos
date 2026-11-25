import { describe, expect, it } from "vitest";
import { abrirBase } from "../../../src/almacen/base/base.js";
import { comprobarElPepper } from "../../../src/almacen/base/pepper.js";
import { huellaDeVerificacionDelPepper } from "../../../src/dominio/identidad/credenciales.js";

const PEPPER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const OTRO = Uint8Array.from({ length: 32 }, (_, i) => 100 + i);
const HUELLA = "a".repeat(64);

function conInvitacionesEIntentos() {
  const db = abrirBase(":memory:");
  const invitar = (id: string, codigo: string, usada: boolean) =>
    db
      .prepare("INSERT INTO invitation (invitation_id, trip_id, codigo_hash, creada_en, vence_en, usada_en, usada_por_device_id) VALUES (?, 't', ?, 1, 99, ?, ?)")
      .run(id, codigo, usada ? 2 : null, usada ? `d-${id}` : null);
  invitar("i1", HUELLA, false);
  invitar("i2", "b".repeat(64), true);
  db.prepare("INSERT INTO join_attempt (ip_hash, intentado_en, ok) VALUES (?, 1, 0)").run("c".repeat(64));
  const contar = (tabla: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;
  return { db, contar };
}

describe("comprobarElPepper", () => {
  it("la primera vez registra la huella, después coincide, y la huella no es el pepper", () => {
    const db = abrirBase(":memory:");
    expect(comprobarElPepper(db, PEPPER, false)).toEqual({ estado: "registrado" });
    expect(comprobarElPepper(db, PEPPER, false)).toEqual({ estado: "coincide" });
    const guardada = (db.prepare("SELECT valor FROM servidor_parametro WHERE clave = 'huella_del_pepper'").get() as { valor: string }).valor;
    expect(guardada).toBe(huellaDeVerificacionDelPepper(PEPPER));
    expect(guardada).toMatch(/^[0-9a-f]{64}$/);
    expect(guardada).not.toContain(Buffer.from(PEPPER).toString("hex"));
  });

  it("con otro pepper y sin aceptarlo devuelve distinto y no toca nada", () => {
    const { db, contar } = conInvitacionesEIntentos();
    comprobarElPepper(db, PEPPER, false);
    expect(comprobarElPepper(db, OTRO, false)).toEqual({ estado: "distinto" });
    expect([contar("invitation"), contar("join_attempt")]).toEqual([2, 1]);
    expect(comprobarElPepper(db, PEPPER, false)).toEqual({ estado: "coincide" });
  });

  it("aceptando el nuevo borra las invitaciones sin usar y los intentos, conserva las usadas y guarda la huella nueva", () => {
    const { db, contar } = conInvitacionesEIntentos();
    comprobarElPepper(db, PEPPER, false);
    expect(comprobarElPepper(db, OTRO, true)).toEqual({ estado: "reemplazado", invitacionesBorradas: 1, intentosBorrados: 1 });
    expect([contar("invitation"), contar("join_attempt")]).toEqual([1, 0]);
    expect(comprobarElPepper(db, OTRO, false)).toEqual({ estado: "coincide" });
    expect(comprobarElPepper(db, PEPPER, false)).toEqual({ estado: "distinto" });
  });

  it("aceptar el nuevo con el mismo pepper no borra nada", () => {
    const { db, contar } = conInvitacionesEIntentos();
    comprobarElPepper(db, PEPPER, false);
    expect(comprobarElPepper(db, PEPPER, true)).toEqual({ estado: "coincide" });
    expect([contar("invitation"), contar("join_attempt")]).toEqual([2, 1]);
  });

  it("la huella de verificación depende solo del pepper", () => {
    expect(huellaDeVerificacionDelPepper(PEPPER)).not.toBe(huellaDeVerificacionDelPepper(OTRO));
    expect(huellaDeVerificacionDelPepper(PEPPER)).toBe(huellaDeVerificacionDelPepper(Uint8Array.from(PEPPER)));
  });
});
