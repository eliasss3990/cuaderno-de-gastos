import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../src/dominio/almacenMemoria.js";
import { dentroDeUnCierre, horaDeCreacion, sincronizarCierre } from "../../src/dominio/cierreViaje.js";
import type { Operacion } from "../../src/dominio/operaciones.js";

const AHORA = 1803006000000 + 1000; // pasado el cierre del 2027-02-18 en Asunción

function viaje(campos: { [campo: string]: string | null }): AlmacenMemoria {
  const a = new AlmacenMemoria();
  a.crearEntidad("trip", "v1");
  for (const [campo, valor] of Object.entries(campos)) a.escribirCampo("trip", "v1", campo, valor, "m1");
  return a;
}

describe("sincronizar el cierre: guardas sobre estados que la validación no deja pasar", () => {
  it("sin viaje no hace nada", () => {
    const a = new AlmacenMemoria();
    sincronizarCierre(a, AHORA, AHORA);
    expect(a.intervalosDeCierre()).toEqual([]);
  });
  it("un viaje sin zona horaria no se toca ni lanza error", () => {
    const a = viaje({ fecha_fin: "2027-02-18" });
    expect(() => sincronizarCierre(a, AHORA, AHORA)).not.toThrow();
    expect(a.intervalosDeCierre()).toEqual([]);
  });
  it("un estado manual desconocido se ignora y rige el estado por fechas", () => {
    const a = viaje({ zona_horaria: "America/Asuncion", fecha_fin: "2027-02-18", estado_manual: "OTRO" });
    sincronizarCierre(a, AHORA, null);
    expect(a.intervalosDeCierre()).toEqual([{ desdeMs: 1803006000000, hastaMs: null, causa: "FECHAS" }]);
  });
  it("un cambio posterior al fin del día de fin abre el cierre por fechas con la hora del cambio", () => {
    const a = viaje({ zona_horaria: "America/Asuncion", fecha_fin: "2027-02-18" });
    sincronizarCierre(a, AHORA, 1803006000000 + 500);
    expect(a.intervalosDeCierre()).toEqual([{ desdeMs: 1803006000500, hastaMs: null, causa: "FECHAS" }]);
  });
  it("si el reloj retrocede, un intervalo abierto por fechas no se cierra sin una operación", () => {
    const a = viaje({ zona_horaria: "America/Asuncion", fecha_fin: "2027-02-18" });
    sincronizarCierre(a, AHORA, null);
    sincronizarCierre(a, 1803006000000 - 5000, null);
    expect(a.intervalosDeCierre()).toEqual([{ desdeMs: 1803006000000, hastaMs: null, causa: "FECHAS" }]);
  });
  it("sincronizar dos veces seguidas no cambia nada", () => {
    const a = viaje({ zona_horaria: "America/Asuncion", fecha_fin: "2027-02-18" });
    sincronizarCierre(a, AHORA, null);
    const antes = a.intervalosDeCierre();
    sincronizarCierre(a, AHORA + 5, null);
    expect(a.intervalosDeCierre()).toEqual(antes);
  });
});

describe("dentro de un cierre", () => {
  const ivs = [{ desdeMs: 10, hastaMs: 20, causa: "MANUAL" as const }, { desdeMs: 30, hastaMs: null, causa: "FECHAS" as const }];
  it("inicio inclusive, fin exclusive, y el abierto no termina", () => {
    const dentro = [10, 19, 30, 31, 1e15];
    const fuera = [0, 9, 20, 25, 29];
    for (const ms of dentro) expect(dentroDeUnCierre(ivs, ms), String(ms)).toBe(true);
    for (const ms of fuera) expect(dentroDeUnCierre(ivs, ms), String(ms)).toBe(false);
    expect(dentroDeUnCierre([], 5)).toBe(false);
  });
  it("la hora de creación es la de la marca", () => {
    const op = { hlc: `${(1234).toString(16).padStart(13, "0")}-0001-018f3a6e-0000-7000-8000-00000000000a` } as Operacion;
    expect(horaDeCreacion(op)).toBe(1234);
  });
});
