import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AlmacenMemoria, type Instantanea } from "../../src/dominio/almacenMemoria.js";
import { MotorOperaciones, type Campos, type Json, type OpGuardada, type Operacion } from "../../src/dominio/operaciones.js";

interface Escenario {
  nombre: string;
  ops: Operacion[];
  ordenes: number[][];
  esperado: Instantanea;
}

const vectores = JSON.parse(
  readFileSync(new URL("../../../conformance/operaciones.json", import.meta.url), "utf8"),
) as { escenarios: Escenario[] };

/** Almacén que falla en la escritura número `restantes + 1`, para comprobar que aplicar es todo o nada. */
class AlmacenQueFalla extends AlmacenMemoria {
  restantes: number | null = null;
  /** Si es true la falla ocurre justo DESPUÉS de cada escritura (la escritura ya se hizo y hay que deshacerla). */
  despues = false;
  escrituras = 0;

  private contar(fase: "antes" | "despues"): void {
    if ((fase === "despues") !== this.despues) return;
    this.escrituras += 1;
    if (this.restantes === null) return;
    if (this.restantes === 0) throw new Error("falla inyectada");
    this.restantes -= 1;
  }

  override crearEntidad(tipo: string, id: string): void {
    this.contar("antes");
    super.crearEntidad(tipo, id);
    this.contar("despues");
  }
  override escribirCampo(tipo: string, id: string, campo: string, valor: Json, hlc: string): void {
    this.contar("antes");
    super.escribirCampo(tipo, id, campo, valor, hlc);
    this.contar("despues");
  }
  override terminar(tipo: string, id: string): void {
    this.contar("antes");
    super.terminar(tipo, id);
    this.contar("despues");
  }
  override redactarPorEntidad(tipo: string, id: string): void {
    this.contar("antes");
    super.redactarPorEntidad(tipo, id);
    this.contar("despues");
  }
  override redactarPorPadre(padreId: string): void {
    this.contar("antes");
    super.redactarPorPadre(padreId);
    this.contar("despues");
  }
  override guardarOp(op: OpGuardada): number {
    this.contar("antes");
    const numero = super.guardarOp(op);
    this.contar("despues");
    return numero;
  }
}

describe("aplicar una operación es todo o nada", () => {
  let fallasProvocadas = 0;

  for (const esc of vectores.escenarios) {
    it(`${esc.nombre}: si falla cualquier escritura (antes o justo después de hacerla) no queda nada a medias y reintentar llega al estado esperado`, () => {
      const orden = esc.ordenes[0] as number[];
      for (const despues of [false, true]) for (let p = 0; p < orden.length; p++) {
        const almacen = new AlmacenQueFalla();
        almacen.despues = despues;
        const motor = new MotorOperaciones(almacen);
        for (const i of orden.slice(0, p)) motor.aplicar(esc.ops[i] as Operacion);
        const antes = almacen.instantanea();
        const secuenciasAntes = almacen.secuencias();
        const siguiente = esc.ops[orden[p] as number] as Operacion;
        for (let k = 0; ; k++) {
          almacen.restantes = k;
          try {
            motor.aplicar(siguiente);
            almacen.restantes = null;
            break; // llegó hasta el final sin fallar: ya probamos todas las escrituras de esta operación
          } catch {
            fallasProvocadas += 1;
            almacen.restantes = null;
            expect(almacen.instantanea()).toEqual(antes);
            expect(almacen.secuencias()).toEqual(secuenciasAntes);
          }
        }
        // la operación que acabó bien ya está aplicada; sigue el resto del escenario
        for (const i of orden.slice(p + 1)) motor.aplicar(esc.ops[i] as Operacion);
        expect(almacen.instantanea()).toEqual(esc.esperado);
        // tras tantas fallas y reintentos la secuencia sigue siendo 1, 2, 3… sin huecos
        const secuencias = almacen.secuencias();
        expect(secuencias).toEqual(secuencias.map((_, i) => i + 1));
      }
    });
  }

  it("se provocaron muchas fallas distintas (la prueba no es vacía)", () => {
    expect(fallasProvocadas).toBeGreaterThan(100);
  });

  it("un payload que no es un objeto se rechaza antes de escribir nada", () => {
    const almacen = new AlmacenMemoria();
    const motor = new MotorOperaciones(almacen);
    const mala = { opId: "o1", tipo: "expense.create", entidadTipo: "expense", entidadId: "e1", hlc: "0000000000064-0000-018f3a6e-0000-7000-8000-00000000000a", payload: null as unknown as Campos };
    expect(motor.aplicar(mala)).toEqual({ estado: "rejected", razon: "formato" });
    expect(almacen.entidadExiste("expense", "e1")).toBe(false);
  });
});
