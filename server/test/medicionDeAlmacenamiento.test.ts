import { describe, expect, it } from "vitest";
import { CADA_DIEZ_MINUTOS_MS, iniciarMedicionDeAlmacenamiento, MEDICION_DIARIA_MS } from "../src/arranque.js";
import { MetricasEnMemoria } from "../src/observabilidad/metricas.js";
import type { MedicionDeAlmacenamiento } from "../src/observabilidad/almacenamiento.js";
import { RegistroDeMemoria } from "./ayudas/registroDeMemoria.js";

const GB = 1024 * 1024 * 1024;
const valor = (m: MetricasEnMemoria, nombre: string) => m.resumen().valores.find((v) => v.nombre === nombre)?.valor;

function armar(mediciones: (MedicionDeAlmacenamiento | Error)[]) {
  const metricas = new MetricasEnMemoria();
  const registro = new RegistroDeMemoria();
  let accion: (() => void) | undefined;
  let cadaMs = 0;
  const cancelados: unknown[] = [];
  const t = {};
  let i = 0;
  const m = iniciarMedicionDeAlmacenamiento({
    medir: async () => {
      const x = mediciones[Math.min(i++, mediciones.length - 1)]!;
      if (x instanceof Error) throw x;
      return x;
    },
    metricas,
    registro,
    periodo: { programar: (a, ms) => ((accion = a), (cadaMs = ms), t), cancelar: (x) => cancelados.push(x) },
  });
  return { m, metricas, registro, disparar: () => accion!(), cadaMs: () => cadaMs, cancelados, t };
}

describe("iniciarMedicionDeAlmacenamiento", () => {
  it("mide cada 10 minutos y detenerlo cancela el temporizador", () => {
    const { m, cadaMs, cancelados, t } = armar([{ baseBytes: 1, adjuntosBytes: 2, libreBytes: 5 * GB }]);
    expect(cadaMs()).toBe(CADA_DIEZ_MINUTOS_MS);
    m.detener();
    expect(cancelados).toEqual([t]);
  });

  it("deja en las métricas el tamaño de la base, de los adjuntos y el espacio libre", async () => {
    const { m, metricas } = armar([{ baseBytes: 4096, adjuntosBytes: 1000, libreBytes: 5 * GB }]);
    await m.medirAhora();
    expect([valor(metricas, "base_bytes"), valor(metricas, "adjuntos_en_disco_bytes"), valor(metricas, "disco_libre_bytes")]).toEqual([4096, 1000, 5 * GB]);
  });

  it("entra en alerta con menos de 1 GiB libre, lo avisa una sola vez, y avisa cuando se recupera", async () => {
    const { m, registro } = armar([
      { baseBytes: 0, adjuntosBytes: 0, libreBytes: 2 * GB },
      { baseBytes: 0, adjuntosBytes: 0, libreBytes: GB - 1 },
      { baseBytes: 0, adjuntosBytes: 0, libreBytes: 100 },
      { baseBytes: 0, adjuntosBytes: 0, libreBytes: GB },
    ]);
    await m.medirAhora();
    expect(m.enAlerta()).toBe(false);
    await m.medirAhora();
    expect(m.enAlerta()).toBe(true);
    await m.medirAhora();
    expect(m.enAlerta()).toBe(true);
    await m.medirAhora();
    expect(m.enAlerta()).toBe(false);
    const avisos = registro.entradas.filter((x) => x.evento === "disco_casi_lleno" || x.evento === "disco_recuperado");
    expect(avisos.map((x) => [x.nivel, x.evento, x.campos.libre_bytes])).toEqual([["warn", "disco_casi_lleno", GB - 1], ["info", "disco_recuperado", GB]]);
  });

  it("un fallo al medir se registra como error y no cambia el estado de alerta", async () => {
    const { m, registro } = armar([{ baseBytes: 0, adjuntosBytes: 0, libreBytes: 100 }, new Error("statfs falló token=SECRETO-1")]);
    await m.medirAhora();
    await m.medirAhora();
    expect(m.enAlerta()).toBe(true);
    const fallo = registro.entradas.find((x) => x.evento === "almacenamiento_medicion_fallo");
    expect(fallo?.nivel).toBe("error");
    expect(JSON.stringify(registro.entradas)).not.toContain("SECRETO-1");
  });

  it("el temporizador dispara una medición, y nunca hay dos a la vez", async () => {
    let llamadas = 0;
    let terminar!: () => void;
    const metricas = new MetricasEnMemoria();
    let accion: (() => void) | undefined;
    const m = iniciarMedicionDeAlmacenamiento({
      medir: () => (llamadas++, new Promise<MedicionDeAlmacenamiento>((ok) => (terminar = () => ok({ baseBytes: 7, adjuntosBytes: 0, libreBytes: 5 * GB })))),
      metricas,
      registro: new RegistroDeMemoria(),
      periodo: { programar: (a) => ((accion = a), {}), cancelar: () => undefined },
    });
    accion!();
    accion!();
    const tambien = m.medirAhora();
    expect(llamadas).toBe(1);
    terminar();
    await tambien;
    expect(valor(metricas, "base_bytes")).toBe(7);
    accion!();
    expect(llamadas).toBe(2);
    terminar();
  });

  it("solo mide si hubo cambios; sin cambios, una vez por día", async () => {
    expect(MEDICION_DIARIA_MS).toBe(24 * 60 * 60 * 1000);
    let llamadas = 0;
    let reloj = 1_000_000;
    let cambios = false;
    let accion: (() => void) | undefined;
    const m = iniciarMedicionDeAlmacenamiento({
      medir: async () => (llamadas++, { baseBytes: 0, adjuntosBytes: 0, libreBytes: 5 * GB }),
      metricas: new MetricasEnMemoria(),
      registro: new RegistroDeMemoria(),
      huboCambios: () => cambios,
      ahora: () => reloj,
      periodo: { programar: (a) => ((accion = a), {}), cancelar: () => undefined },
    });
    const disparar = async () => {
      accion!();
      await Promise.resolve();
      await Promise.resolve();
    };
    await m.medirAhora();
    expect(llamadas).toBe(1);
    reloj += CADA_DIEZ_MINUTOS_MS;
    await disparar();
    expect(llamadas).toBe(1); // sin cambios y medido hace poco
    cambios = true;
    await disparar();
    expect(llamadas).toBe(2);
    cambios = false;
    reloj += MEDICION_DIARIA_MS - 1;
    await disparar();
    expect(llamadas).toBe(2); // todavía no pasó un día desde la última
    reloj += 1;
    await disparar();
    expect(llamadas).toBe(3); // un día sin cambios: mide igual
  });

  it("sin medición previa, el primer disparo mide aunque no haya cambios", async () => {
    let llamadas = 0;
    let accion: (() => void) | undefined;
    iniciarMedicionDeAlmacenamiento({
      medir: async () => (llamadas++, { baseBytes: 0, adjuntosBytes: 0, libreBytes: 5 * GB }),
      metricas: new MetricasEnMemoria(),
      registro: new RegistroDeMemoria(),
      huboCambios: () => false,
      ahora: () => 0,
      periodo: { programar: (a) => ((accion = a), {}), cancelar: () => undefined },
    });
    accion!();
    expect(llamadas).toBe(1);
  });

  it("una escritura durante una medición en curso no se pierde: se mide en el disparo siguiente", async () => {
    let llamadas = 0;
    let soltar: (() => void) | undefined;
    let cambios = false;
    let accion: (() => void) | undefined;
    const m = iniciarMedicionDeAlmacenamiento({
      medir: async () => {
        llamadas++;
        await new Promise<void>((ok) => (soltar = ok));
        return { baseBytes: 0, adjuntosBytes: 0, libreBytes: 5 * GB };
      },
      metricas: new MetricasEnMemoria(),
      registro: new RegistroDeMemoria(),
      huboCambios: () => {
        const hubo = cambios;
        cambios = false;
        return hubo;
      },
      ahora: () => 0,
      periodo: { programar: (a) => ((accion = a), {}), cancelar: () => undefined },
    });
    const enVuelo = m.medirAhora();
    cambios = true; // la escritura llega mientras se mide
    accion!();
    expect(llamadas).toBe(1);
    soltar!();
    await enVuelo;
    accion!();
    expect(llamadas).toBe(2);
    soltar!();
  });
});

