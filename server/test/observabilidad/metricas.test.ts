import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CADA_HORA_MS,
  claveDeSerie,
  iniciarMedicion,
  iniciarResumenPeriodico,
  MAX_SERIES,
  MetricasEnMemoria,
  type ResumenDeMetricas,
  metricasNulas,
  resumenACampos,
} from "../../src/observabilidad/metricas.js";
import { crearRegistroPino } from "../../src/observabilidad/registroPino.js";
import { RegistroDeMemoria } from "../ayudas/registroDeMemoria.js";
import { Writable } from "node:stream";

afterEach(() => vi.useRealTimers());

describe("contar, medir y fijar", () => {
  it("un contador suma, vale 1 por defecto y separa las series por etiquetas sin importar su orden", () => {
    const m = new MetricasEnMemoria();
    m.contar("ops_aceptadas");
    m.contar("ops_aceptadas", 4);
    m.contar("ops_rechazadas", 1, { motivo: "viaje_cerrado" });
    m.contar("ops_rechazadas", 2, { motivo: "viaje_cerrado" });
    m.contar("ops_rechazadas", 1, { motivo: "limite_superado" });
    m.contar("pedidos", 1, { metodo: "get", ruta: "head" });
    m.contar("pedidos", 1, { ruta: "head", metodo: "get" });
    expect(resumenACampos(m.resumen()).contadores).toEqual({
      ops_aceptadas: 5,
      "ops_rechazadas{motivo=viaje_cerrado}": 3,
      "ops_rechazadas{motivo=limite_superado}": 1,
      "pedidos{metodo=get,ruta=head}": 2,
    });
  });

  it("un contador acepta 0", () => {
    const m = new MetricasEnMemoria();
    m.contar("c", 0);
    expect(m.resumen().contadores).toEqual([{ nombre: "c", etiquetas: {}, valor: 0 }]);
  });

  it("una medición resume cantidad, suma, mínimo y máximo", () => {
    const m = new MetricasEnMemoria();
    for (const ms of [30, 10, 20]) m.medir("pedido_ms", ms, { ruta: "ops" });
    expect(m.resumen().mediciones).toEqual([{ nombre: "pedido_ms", etiquetas: { ruta: "ops" }, cantidad: 3, suma: 60, minimo: 10, maximo: 30 }]);
    m.medir("otra_ms", 0);
    expect(m.resumen().mediciones[1]).toMatchObject({ cantidad: 1, suma: 0, minimo: 0, maximo: 0 });
  });

  it("un valor fijado guarda el último, y puede ser negativo o cero", () => {
    const m = new MetricasEnMemoria();
    m.fijar("conexiones_abiertas", 3);
    m.fijar("conexiones_abiertas", 1);
    m.fijar("temperatura", -4.5);
    expect(resumenACampos(m.resumen()).valores).toEqual({ conexiones_abiertas: 1, temperatura: -4.5 });
  });

  it("lo que devuelve resumen es una copia: modificarla no cambia lo acumulado", () => {
    const m = new MetricasEnMemoria();
    m.contar("c", 1, { a: "x" });
    const r = m.resumen();
    (r.contadores[0] as { valor: number }).valor = 999;
    (r.contadores[0]!.etiquetas as Record<string, string>).a = "cambiada";
    expect(resumenACampos(m.resumen()).contadores).toEqual({ "c{a=x}": 1 });
  });

  it("las etiquetas que se pasan se copian: cambiarlas después no mueve la serie", () => {
    const m = new MetricasEnMemoria();
    const etiquetas = { a: "x" };
    m.contar("c", 1, etiquetas);
    m.medir("d", 1, etiquetas);
    m.fijar("g", 1, etiquetas);
    etiquetas.a = "y";
    const r = m.resumen();
    expect(r.contadores[0]!.etiquetas).toEqual({ a: "x" });
    expect(r.mediciones[0]!.etiquetas).toEqual({ a: "x" });
    expect(r.valores[0]!.etiquetas).toEqual({ a: "x" });
  });
});

describe("validación", () => {
  const malosNombres: unknown[] = ["", "Ops", "1ops", "ops-aceptadas", "ops aceptadas", "ops.x", "ñ", undefined, null, 5, {}];

  it("un nombre que no es un identificador en minúsculas con guiones bajos se rechaza y no deja rastro", () => {
    const m = new MetricasEnMemoria();
    for (const n of malosNombres) {
      expect(() => m.contar(n as string)).toThrow(RangeError);
      expect(() => m.medir(n as string, 1)).toThrow(RangeError);
      expect(() => m.fijar(n as string, 1)).toThrow(RangeError);
    }
    expect(m.resumen()).toEqual({ contadores: [], mediciones: [], valores: [], descartadas: 0, ejemplo: null });
  });

  it("las etiquetas se validan: nombre, tipo del valor y largo (64 sí, 65 no)", () => {
    const m = new MetricasEnMemoria();
    for (const e of [{ Mal: "x" }, { "a-b": "x" }, { a: 5 }, { a: null }, { a: "x".repeat(65) }, "texto", ["a"], null] as unknown[]) {
      expect(() => m.contar("c", 1, e as Record<string, string>)).toThrow(RangeError);
    }
    m.contar("c", 1, { a: "abc/".repeat(16) }); // 64 caracteres, sin corridas largas
    expect(m.resumen().contadores).toHaveLength(1);
    expect(() => m.contar("c", 1, { a: "abc/".repeat(16) + "x" })).toThrow(RangeError); // 65
  });

  it("valores que no son números finitos se rechazan; un contador no baja y una duración no es negativa", () => {
    const m = new MetricasEnMemoria();
    for (const v of [NaN, Infinity, -Infinity, "5", null, {}] as unknown[]) {
      expect(() => m.contar("c", v as number)).toThrow(RangeError);
      expect(() => m.fijar("c", v as number)).toThrow(RangeError);
    }
    for (const v of [NaN, Infinity, "5", null, undefined] as unknown[]) expect(() => m.medir("d", v as number)).toThrow(RangeError);
    expect(() => m.contar("c", -1)).toThrow("no baja");
    expect(() => m.medir("d", -1)).toThrow("negativa");
    expect(m.resumen()).toEqual({ contadores: [], mediciones: [], valores: [], descartadas: 0, ejemplo: null });
  });
});

describe("modo no estricto (producción): lo inválido se descarta y se cuenta, no lanza", () => {
  it("un nombre, una etiqueta o un valor inválido no lanza y suma a descartadas; lo válido se anota", () => {
    const m = new MetricasEnMemoria(500, false);
    m.contar("Mal");
    m.contar("c", -1);
    m.contar("c", NaN);
    m.contar("c", 1, { ruta: "x".repeat(65) });
    m.contar("c", 1, { Mal: "x" });
    m.medir("d", -5);
    m.medir("D", 1);
    m.fijar("g", Infinity);
    m.fijar("G", 1);
    m.contar("bien", 2);
    const r = m.resumen();
    expect(r.descartadas).toBe(9); // las 9 llamadas inválidas de arriba
    expect(r.contadores).toEqual([{ nombre: "bien", etiquetas: {}, valor: 2 }]);
    expect(r.mediciones).toEqual([]);
    expect(r.valores).toEqual([]);
  });

  it("por defecto es estricto y lanza", () => {
    expect(() => new MetricasEnMemoria().contar("Mal")).toThrow(RangeError);
    expect(() => new MetricasEnMemoria(500, true).contar("c", -1)).toThrow(RangeError);
  });

  it("tampoco lanza ante un error inesperado: lo descarta y lo cuenta", () => {
    const m = new MetricasEnMemoria(500, false);
    const etiquetas = new Proxy({}, { ownKeys: () => { throw new TypeError("falla interna"); } });
    expect(() => m.contar("c", 1, etiquetas as Record<string, string>)).not.toThrow();
    expect(m.resumen()).toMatchObject({ descartadas: 1, ejemplo: "c", contadores: [] });
  });

  it("guarda el nombre de la primera anotación descartada del período para encontrar el error, y se reinicia con el resumen", () => {
    const m = new MetricasEnMemoria(500, false);
    expect(m.resumen().ejemplo).toBeNull();
    m.contar("MalNombre");
    m.contar("OtroMal");
    expect(m.resumen()).toMatchObject({ descartadas: 2, ejemplo: "MalNombre" });
    expect(m.tomarResumen().ejemplo).toBe("MalNombre");
    expect(m.resumen()).toMatchObject({ descartadas: 0, ejemplo: null });
    m.contar(123 as unknown as string);
    expect(m.resumen().ejemplo).toBe("[no es un nombre]");
    m.tomarResumen();
    // lo que no parece un nombre no se escribe: un correo, un texto largo, un token, muchos dígitos
    for (const raro of ["juan.perez@gmail.com", "juan.perez.gmail.com", "M".repeat(100), "x".repeat(40), "token=ABC", "5491155551234", "600.123.456", "con espacios"]) {
      const n = new MetricasEnMemoria(500, false);
      n.contar(raro);
      expect([raro, n.resumen().ejemplo]).toEqual([raro, "[no es un nombre]"]);
    }
    const bueno = new MetricasEnMemoria(500, false);
    bueno.contar("HTTP_Requests-Mal");
    expect(bueno.resumen().ejemplo).toBe("HTTP_Requests-Mal");
    // el borde: 31 caracteres sí (32 ya es una corrida larga) y vacío no
    const borde = (nombre: string) => { const n = new MetricasEnMemoria(500, false); n.contar(nombre); return n.resumen().ejemplo; };
    expect(borde("A".repeat(31))).toBe("A".repeat(31));
    expect(borde("A".repeat(32))).toBe("[no es un nombre]");
    expect(borde("")).toBe("[no es un nombre]");
  });

  it("también cuenta el tope de series entre las descartadas, pero no guarda ejemplo (no hay nombre inválido)", () => {
    const m = new MetricasEnMemoria(1, false);
    m.contar("a");
    m.contar("b");
    expect(m.resumen()).toMatchObject({ descartadas: 1, ejemplo: null });
  });
});

describe("valores de etiqueta", () => {
  it("solo letras, números y . : / _ - (una plantilla de ruta sirve), sin imitar a otra etiqueta ni la forma de un token", () => {
    const m = new MetricasEnMemoria();
    for (const bueno of ["", "get", "/v1/trips/:trip/ops", "a.b-c_d:e/f", "abc/".repeat(16), "200", "dependiente_de_op_rechazada"]) m.contar("c", 1, { v: bueno });
    expect(m.resumen().contadores).toHaveLength(7);
    for (const malo of ["1,b=2", "a b", "{x}", "a=b", "ñ", "a;b", "a\nb", "/join/Zk3vQ9-xL2mN8_pR5tW7yB1cD4fG6hJ0aS2eU3iO9kA", "Zk3vQ9-xL2mN8_pR5tW7yB1cD4fG6hJ0aS2eU3iO9kA"]) {
      expect(() => new MetricasEnMemoria().contar("c", 1, { v: malo }), `valor ${JSON.stringify(malo)}`).toThrow(RangeError);
    }
  });

  it("dos etiquetas distintas nunca producen la misma clave de serie", () => {
    const m = new MetricasEnMemoria(500, false);
    m.contar("x", 1, { a: "1,b=2" }); // inválida: se descarta
    m.contar("x", 1, { a: "1", b: "2" });
    expect(m.resumen().contadores).toHaveLength(1);
    expect(m.resumen().descartadas).toBe(1);
  });
});

describe("lo que parece un dato no entra como nombre ni como etiqueta", () => {
  const datos = ["a".repeat(32), "0123456789abcdef".repeat(4), "0193b4c2-7e1f-7abc-8def-0123456789ab", "5491155551234", "600.123.456", "600-123-456", "eyJhbGciOiJ.eyJzdWIiOiIx.abc"];

  it("valores de etiqueta: un sha256, un UUID, un teléfono, un JWT corto o una corrida larga se rechazan", () => {
    for (const dato of datos) expect(() => new MetricasEnMemoria().contar("c", 1, { v: dato }), dato).toThrow(RangeError);
  });

  it("nombres de métrica y de etiqueta con una corrida larga se rechazan", () => {
    expect(() => new MetricasEnMemoria().contar("a" + "b".repeat(60))).toThrow(RangeError);
    expect(() => new MetricasEnMemoria().contar("c", 1, { ["k".repeat(40)]: "v" })).toThrow(RangeError);
    expect(() => new MetricasEnMemoria().contar("a".repeat(31))).not.toThrow(); // una corrida de 31 sí
  });

  it("un getter en las etiquetas no puede devolver otro valor después de validar", () => {
    const m = new MetricasEnMemoria();
    let lecturas = 0;
    const etiquetas = { get motivo(): string { return lecturas++ < 1 ? "ok" : "a@b.com secreto"; } };
    m.contar("c", 1, etiquetas);
    expect(JSON.stringify(m.resumen())).not.toContain("secreto");
    expect(m.resumen().contadores[0]!.etiquetas).toEqual({ motivo: "ok" });
  });

  it("un resumen fabricado con valores que no son números finitos también se omite (nada de texto en un contador)", () => {
    const base = { etiquetas: {}, nombre: "a" };
    const falso = {
      contadores: [{ ...base, valor: "Bearer-secreto juan@x.com" }, { ...base, nombre: "b", valor: NaN }, { ...base, nombre: "c", valor: Infinity }, { ...base, nombre: "ok", valor: 4 }],
      mediciones: [
        { ...base, cantidad: { x: "clave123" }, suma: 1, minimo: 1, maximo: 1 },
        { ...base, nombre: "m2", cantidad: 1, suma: "pw", minimo: 1, maximo: 1 },
        { ...base, nombre: "m3", cantidad: 1, suma: 1, minimo: null, maximo: 1 },
        { ...base, nombre: "m4", cantidad: 1, suma: 1, minimo: 1, maximo: undefined },
        { ...base, nombre: "m5", cantidad: 2, suma: 5, minimo: 1, maximo: 4 },
      ],
      valores: [{ ...base, nombre: "g", valor: "texto libre" }, { ...base, nombre: "g2", valor: -3 }],
      descartadas: 0,
      ejemplo: null,
    } as unknown as ResumenDeMetricas;
    const c = resumenACampos(falso) as { contadores: object; mediciones: object; valores: object; descartadas: number };
    expect(c.contadores).toEqual({ ok: 4 });
    expect(c.mediciones).toEqual({ m5: { cantidad: 2, suma: 5, minimo: 1, maximo: 4 } });
    expect(c.valores).toEqual({ g2: -3 });
    expect(c.descartadas).toBe(8); // 3 contadores + 4 mediciones + 1 valor omitidos
    expect(JSON.stringify(c)).not.toContain("secreto");
  });

  it("un resumen fabricado con getters se lee una sola vez: lo que devuelve la segunda lectura no entra", () => {
    const una = <T,>(primera: T, despues: unknown) => { let n = 0; return () => (n++ < 1 ? primera : despues); };
    const serie = (nombre: string, extra: object) => Object.defineProperties({ nombre, etiquetas: {}, valor: 1 }, Object.fromEntries(Object.entries(extra).map(([k, g]) => [k, { get: g as () => unknown, enumerable: true }])));
    const falso = {
      contadores: [
        serie("a", { valor: una(1, "secreto@x.com") }),
        serie("b", { etiquetas: una({ motivo: "ok" }, { motivo: "juan@x.com,b=5" }) }),
        serie("c", { nombre: una("c", "juan@x.com") }),
      ],
      mediciones: [Object.defineProperty({ nombre: "m", etiquetas: {}, cantidad: 1, suma: 1, minimo: 1, maximo: 1 }, "suma", { get: una(1, "pw@x.com"), enumerable: true })],
      valores: [],
      descartadas: 0,
      ejemplo: null,
    } as unknown as ResumenDeMetricas;
    const c = JSON.stringify(resumenACampos(falso));
    for (const dato of ["secreto@x.com", "juan@x.com", "pw@x.com"]) expect(c).not.toContain(dato);
    expect(JSON.parse(c)).toMatchObject({ contadores: { a: 1, "b{motivo=ok}": 1, c: 1 }, mediciones: { m: { suma: 1 } } });
  });

  it("un resumen fabricado con huecos o series que no son objetos no lanza: se omiten y se cuentan", () => {
    const falso = { contadores: [undefined, null, 5, "texto", { nombre: "ok", etiquetas: {}, valor: 2 }], mediciones: [undefined], valores: [null], descartadas: 0, ejemplo: null } as unknown as ResumenDeMetricas;
    const c = resumenACampos(falso) as { contadores: object; descartadas: number };
    expect(c.contadores).toEqual({ ok: 2 });
    expect(c.descartadas).toBe(6);
  });

  it("el contador de descartadas y el ejemplo de un resumen fabricado también se validan", () => {
    const base = { contadores: [], mediciones: [], valores: [] };
    const con = (descartadas: unknown, ejemplo: unknown) => resumenACampos({ ...base, descartadas, ejemplo } as unknown as ResumenDeMetricas) as { descartadas: number; ejemplo_descartada?: unknown };
    expect(con({ valueOf: () => "a@b.com" }, null).descartadas).toBe(0);
    for (const malo of [NaN, Infinity, "5", null, undefined]) expect(con(malo, null).descartadas).toBe(0);
    expect(con(3, null).descartadas).toBe(3);
    expect(con(0, null)).not.toHaveProperty("ejemplo_descartada");
    expect(con(0, "MalNombre").ejemplo_descartada).toBe("MalNombre");
    for (const raro of [{ toString: () => "x" }, "juan@x.com", "x".repeat(40), "5491155551234", 7, ""]) expect([raro, con(0, raro).ejemplo_descartada]).toEqual([raro, "[no es un nombre]"]);
  });

  it("un resumen fabricado desde fuera se revalida: las series inválidas se omiten y se cuentan", () => {
    const falso: ResumenDeMetricas = {
      contadores: [
        { nombre: "x", etiquetas: { email: "a@b.com password=hunter2" }, valor: 1 },
        { nombre: "bien", etiquetas: { motivo: "ok" }, valor: 2 },
        { nombre: "Mal Nombre", etiquetas: {}, valor: 3 },
      ],
      mediciones: [{ nombre: "d", etiquetas: { v: "a".repeat(40) }, cantidad: 1, suma: 1, minimo: 1, maximo: 1 }],
      valores: [{ nombre: "g", etiquetas: { v: "5491155551234" }, valor: 1 }],
      descartadas: 1,
      ejemplo: null,
    };
    const c = resumenACampos(falso) as { contadores: Record<string, number>; mediciones: object; valores: object; descartadas: number };
    expect(c.descartadas).toBe(5);
    expect(c.contadores).toEqual({ "bien{motivo=ok}": 2 });
    expect(c.mediciones).toEqual({});
    expect(c.valores).toEqual({});
    expect(c.descartadas).toBe(5); // la 1 que ya traía más las 4 omitidas
    expect(JSON.stringify(c)).not.toContain("hunter2");
  });
});

describe("el temporizador del resumen", () => {
  it("un fallo al escribir no sale del callback (no tumba el proceso) y el siguiente intento funciona", () => {
    const m = new MetricasEnMemoria();
    let falla = true;
    const entradas: string[] = [];
    const registro = { debug() {}, info(e: string) { if (falla) throw new Error("disco lleno"); entradas.push(e); }, warn() {}, error() {}, hijo() { return registro; } };
    let accion: (() => void) | undefined;
    iniciarResumenPeriodico({ metricas: m, registro, programar: (a) => ((accion = a), {}) });
    expect(() => accion!()).not.toThrow();
    falla = false;
    accion!();
    expect(entradas).toEqual(["metricas_resumen"]);
  });
});

describe("el resumen llega al log entero y sin mutilar", () => {
  const destino = () => {
    const lineas: string[] = [];
    return { lineas, stream: new Writable({ write(c: Buffer, _e, cb) { lineas.push(...c.toString().split("\n").filter((l) => l !== "")); cb(); } }) };
  };

  it("con pino real: las claves con etiquetas como code=200 y 404 quedan distintas y completas", () => {
    const d = destino();
    const m = new MetricasEnMemoria();
    m.contar("http_requests", 1, { code: "200" });
    m.contar("http_requests", 5, { code: "404" });
    m.contar("pedidos", 2, { status_code: "500", metodo: "get" });
    let accion: (() => void) | undefined;
    iniciarResumenPeriodico({ metricas: m, registro: crearRegistroPino({ destino: d.stream }), programar: (a) => ((accion = a), {}) });
    accion!();
    const linea = JSON.parse(d.lineas[0]!) as { evento: string; contadores: Record<string, number> };
    expect(linea.evento).toBe("metricas_resumen");
    expect(linea.contadores).toEqual({ "http_requests{code=200}": 1, "http_requests{code=404}": 5, "pedidos{metodo=get,status_code=500}": 2 });
  });

  it("las mediciones y los valores tampoco se mutilan: sus claves con etiquetas code=200 salen completas", () => {
    const d = destino();
    const m = new MetricasEnMemoria();
    m.medir("pedido_ms", 12, { code: "200" });
    m.medir("pedido_ms", 30, { code: "404" });
    m.fijar("conexiones", 3, { code: "200" });
    m.fijar("conexiones", 4, { code: "404" });
    let accion: (() => void) | undefined;
    iniciarResumenPeriodico({ metricas: m, registro: crearRegistroPino({ destino: d.stream }), programar: (a) => ((accion = a), {}) });
    accion!();
    const linea = JSON.parse(d.lineas[0]!) as { mediciones: Record<string, { suma: number }>; valores: Record<string, number> };
    expect(Object.keys(linea.mediciones).sort()).toEqual(["pedido_ms{code=200}", "pedido_ms{code=404}"]);
    expect(linea.mediciones["pedido_ms{code=404}"]!.suma).toBe(30);
    expect(linea.valores).toEqual({ "conexiones{code=200}": 3, "conexiones{code=404}": 4 });
  });

  it("con 250 series no se corta nada ni se pierde un contador", () => {
    const d = destino();
    const m = new MetricasEnMemoria();
    for (let i = 0; i < 250; i++) m.contar("pedidos", i + 1, { codigo_http: String(200 + i) });
    let accion: (() => void) | undefined;
    iniciarResumenPeriodico({ metricas: m, registro: crearRegistroPino({ destino: d.stream }), programar: (a) => ((accion = a), {}) });
    accion!();
    const { contadores } = JSON.parse(d.lineas[0]!) as { contadores: Record<string, number> };
    expect(Object.keys(contadores)).toHaveLength(250);
    expect(contadores).not.toHaveProperty("[más]");
    expect(contadores["pedidos{codigo_http=449}"]).toBe(250);
  });

  it("una métrica con una palabra sensible en el nombre (token_invalido) se conserva con su valor", () => {
    const m = new MetricasEnMemoria();
    m.contar("token_invalido", 3, { motivo: "token_vencido" });
    const registro = new RegistroDeMemoria();
    let accion: (() => void) | undefined;
    iniciarResumenPeriodico({ metricas: m, registro, programar: (a) => ((accion = a), {}) });
    accion!();
    expect(registro.entradas[0]!.campos.contadores).toEqual({ "token_invalido{motivo=token_vencido}": 3 });
  });

  it("el ejemplo de lo descartado se escribe en el resumen, y un nombre con datos no se escribe", () => {
    const m = new MetricasEnMemoria(500, false);
    m.contar("token=SECRETO-ABC");
    const registro = new RegistroDeMemoria();
    let accion: (() => void) | undefined;
    iniciarResumenPeriodico({ metricas: m, registro, programar: (a) => ((accion = a), {}) });
    accion!();
    expect(registro.entradas[0]!.campos).toMatchObject({ descartadas: 1, ejemplo_descartada: "[no es un nombre]" });
    expect(JSON.stringify(registro.entradas[0]!.campos)).not.toContain("SECRETO-ABC");
    const sin = new MetricasEnMemoria();
    expect(resumenACampos(sin.resumen())).not.toHaveProperty("ejemplo_descartada");
  });
});

describe("tope de series", () => {
  it("por defecto son 500 y las anotaciones de series nuevas se descartan y se cuentan, sin tocar las existentes", () => {
    expect(MAX_SERIES).toBe(500);
    const m = new MetricasEnMemoria(3);
    m.contar("a");
    m.medir("b", 1);
    m.fijar("c", 1);
    m.contar("d"); // cuarta serie: se descarta
    m.medir("e", 1);
    m.fijar("f", 1);
    expect(m.resumen().descartadas).toBe(3);
    m.contar("a", 2); // una serie existente sigue sumando
    m.medir("b", 5);
    m.fijar("c", 9);
    const r = m.resumen();
    expect(r.contadores).toEqual([{ nombre: "a", etiquetas: {}, valor: 3 }]);
    expect(r.mediciones[0]).toMatchObject({ cantidad: 2, suma: 6 });
    expect(r.valores[0]!.valor).toBe(9);
    expect(r.descartadas).toBe(3);
  });

  it("el tope vale para una etiqueta con valores sin fin (un identificador por pedido)", () => {
    const m = new MetricasEnMemoria();
    for (let i = 0; i < MAX_SERIES + 100; i++) m.contar("pedidos", 1, { viaje: `v${i}` });
    const r = m.resumen();
    expect(r.contadores).toHaveLength(MAX_SERIES);
    expect(r.descartadas).toBe(100);
  });

  it("tras tomar el resumen los contadores liberan lugar y las descartadas vuelven a 0", () => {
    const m = new MetricasEnMemoria(2);
    m.contar("a");
    m.contar("b");
    m.contar("c");
    expect(m.tomarResumen().descartadas).toBe(1);
    m.contar("c");
    expect(m.resumen()).toMatchObject({ contadores: [{ nombre: "c", valor: 1 }], descartadas: 0 });
  });
});

describe("tomarResumen", () => {
  it("devuelve lo acumulado y reinicia contadores y mediciones, pero conserva los valores actuales", () => {
    const m = new MetricasEnMemoria();
    m.contar("c", 5);
    m.medir("d", 7);
    m.fijar("g", 42);
    const primero = m.tomarResumen();
    expect(primero.contadores).toHaveLength(1);
    expect(primero.mediciones).toHaveLength(1);
    expect(primero.valores).toHaveLength(1);
    const segundo = m.tomarResumen();
    expect(segundo.contadores).toEqual([]);
    expect(segundo.mediciones).toEqual([]);
    expect(segundo.valores).toEqual([{ nombre: "g", etiquetas: {}, valor: 42 }]);
    m.contar("c");
    expect(m.resumen().contadores[0]!.valor).toBe(1); // empieza de cero, no de 5
  });

  it("lo ya devuelto no cambia por lo que se anote después", () => {
    const m = new MetricasEnMemoria();
    m.contar("c");
    const r = m.tomarResumen();
    m.contar("c", 10);
    expect(r.contadores[0]!.valor).toBe(1);
  });
});

describe("claveDeSerie y resumenACampos", () => {
  it("la clave ordena las etiquetas y no agrega llaves si no hay", () => {
    expect(claveDeSerie("a", {})).toBe("a");
    expect(claveDeSerie("a", { z: "1", b: "2" })).toBe("a{b=2,z=1}");
    // por código de carácter y no por idioma: dígito, guion bajo y letra, en ese orden (localeCompare pondría "b_" antes que "b0")
    expect(claveDeSerie("m", { b_: "1", b0: "2", a: "3" })).toBe("m{a=3,b0=2,b_=1}");
  });

  it("el resumen como campos de log cuenta las descartadas", () => {
    const m = new MetricasEnMemoria(1);
    m.contar("a");
    m.contar("b");
    m.contar("c");
    expect(resumenACampos(m.resumen()).descartadas).toBe(2);
  });

  it("el resumen como campos de log trae contadores, mediciones, valores y descartadas, sin listas anidadas", () => {
    const m = new MetricasEnMemoria();
    m.contar("ops_aceptadas", 12);
    m.medir("pedido_ms", 20, { ruta: "ops" });
    m.fijar("base_bytes", 4096);
    expect(resumenACampos(m.resumen())).toEqual({
      contadores: { ops_aceptadas: 12 },
      mediciones: { "pedido_ms{ruta=ops}": { cantidad: 1, suma: 20, minimo: 20, maximo: 20 } },
      valores: { base_bytes: 4096 },
      descartadas: 0,
    });
  });
});

describe("iniciarResumenPeriodico", () => {
  it("programa cada hora (3.600.000 ms), no imprime al empezar y cada vez imprime solo lo del período", () => {
    expect(CADA_HORA_MS).toBe(3_600_000);
    const m = new MetricasEnMemoria();
    const registro = new RegistroDeMemoria();
    let accion: (() => void) | undefined;
    let cadaMs = 0;
    iniciarResumenPeriodico({ metricas: m, registro, programar: (a, ms) => ((accion = a), (cadaMs = ms), {}) });
    expect(cadaMs).toBe(3_600_000);
    expect(registro.entradas).toEqual([]);
    m.contar("ops_aceptadas", 7);
    m.fijar("conexiones", 2);
    accion!();
    accion!();
    expect(registro.entradas.map((e) => [e.nivel, e.evento])).toEqual([["info", "metricas_resumen"], ["info", "metricas_resumen"]]);
    expect(registro.entradas[0]!.campos).toMatchObject({ contadores: { ops_aceptadas: 7 }, valores: { conexiones: 2 }, descartadas: 0 });
    // el segundo resumen cuenta solo su período: sin contadores (toEqual: un objeto vacío en toMatchObject acepta cualquier cosa)
    expect(registro.entradas[1]!.campos.contadores).toEqual({});
    expect(registro.entradas[1]!.campos.valores).toEqual({ conexiones: 2 });
  });

  it("devuelve la función que lo detiene, con el mismo temporizador, y el temporizador no retiene al proceso (unref)", () => {
    let unref = 0;
    const temporizador = { unref: () => void unref++ };
    const cancelados: unknown[] = [];
    const detener = iniciarResumenPeriodico({ metricas: new MetricasEnMemoria(), registro: new RegistroDeMemoria(), programar: () => temporizador, cancelar: (t) => cancelados.push(t) });
    expect(unref).toBe(1);
    expect(cancelados).toEqual([]);
    detener();
    expect(cancelados).toEqual([temporizador]);
  });

  it("rechaza un intervalo que no es un número positivo", () => {
    for (const cadaMs of [0, -1, NaN, Infinity]) {
      expect(() => iniciarResumenPeriodico({ metricas: new MetricasEnMemoria(), registro: new RegistroDeMemoria(), cadaMs })).toThrow(RangeError);
    }
  });

  it("con los temporizadores reales imprime una vez por hora y deja de hacerlo al detenerlo", () => {
    vi.useFakeTimers();
    const m = new MetricasEnMemoria();
    const registro = new RegistroDeMemoria();
    const detener = iniciarResumenPeriodico({ metricas: m, registro });
    m.contar("c");
    vi.advanceTimersByTime(3_600_000 - 1);
    expect(registro.entradas).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(registro.entradas).toHaveLength(1);
    vi.advanceTimersByTime(2 * 3_600_000);
    expect(registro.entradas).toHaveLength(3);
    detener();
    vi.advanceTimersByTime(5 * 3_600_000);
    expect(registro.entradas).toHaveLength(3);
  });

  it("el resumen conserva los nombres de las métricas aunque lleven una palabra sensible (son identificadores ya validados)", () => {
    const m = new MetricasEnMemoria();
    m.contar("token", 1);
    const registro = new RegistroDeMemoria();
    let accion: (() => void) | undefined;
    iniciarResumenPeriodico({ metricas: m, registro, programar: (a) => ((accion = a), {}) });
    accion!();
    expect(registro.entradas[0]!.campos.contadores).toEqual({ token: 1 });
  });
});

describe("iniciarMedicion", () => {
  it("anota la duración con el nombre y las etiquetas y la devuelve", () => {
    const m = new MetricasEnMemoria();
    let ahora = 100;
    const fin = iniciarMedicion(m, "pedido_ms", { ruta: "ops" }, () => ahora);
    ahora = 142.5;
    expect(fin()).toBe(42.5);
    expect(m.resumen().mediciones).toEqual([{ nombre: "pedido_ms", etiquetas: { ruta: "ops" }, cantidad: 1, suma: 42.5, minimo: 42.5, maximo: 42.5 }]);
  });

  it("un reloj que retrocede da 0 y no una duración negativa", () => {
    const m = new MetricasEnMemoria();
    let ahora = 100;
    const fin = iniciarMedicion(m, "d_ms", undefined, () => ahora);
    ahora = 50;
    expect(fin()).toBe(0);
    expect(m.resumen().mediciones[0]).toMatchObject({ suma: 0 });
  });

  it("con el reloj por defecto mide un tiempo real no negativo", () => {
    const m = new MetricasEnMemoria();
    const ms = iniciarMedicion(m, "d_ms")();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(m.resumen().mediciones[0]!.cantidad).toBe(1);
  });
});

describe("metricasNulas", () => {
  it("no guardan ni validan nada y no lanzan", () => {
    metricasNulas.contar("cualquier cosa");
    metricasNulas.medir("x", -1);
    metricasNulas.fijar("y", NaN);
  });
});
