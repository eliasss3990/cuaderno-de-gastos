// Métricas del servidor. El resto del código depende de la interfaz `Metricas`: hoy se acumulan en memoria y se imprimen en el
// log cada hora (`iniciarResumenPeriodico`); para conectar OpenTelemetry se escribe otro adaptador. Nombres y nombres de etiqueta
// son identificadores en minúsculas con guiones bajos; el valor de una etiqueta tiene pocos valores posibles (nunca un id de
// viaje, dispositivo u operación, ni una ruta con parámetros) de hasta 64 caracteres con solo letras, números y . : / _ - Cada combinación es una serie y hay
// un tope. El resumen se escribe sin limpiar: ni los nombres ni las etiquetas deben llevar datos (se rechaza lo que parece uno).

import { marcarLimpio, pareceUnDato, type Registro } from "./registro.js";

export type Etiquetas = Readonly<Record<string, string>>;

export interface Metricas {
  /** Suma `valor` (1 si falta, nunca negativo) a un contador: operaciones aceptadas, pedidos, errores... */
  contar(nombre: string, valor?: number, etiquetas?: Etiquetas): void;
  /** Anota una duración en milisegundos (nunca negativa): se resume en cantidad, suma, mínimo y máximo. */
  medir(nombre: string, milisegundos: number, etiquetas?: Etiquetas): void;
  /** Fija el valor actual de algo que sube y baja: conexiones abiertas, tamaño de la base, espacio libre. */
  fijar(nombre: string, valor: number, etiquetas?: Etiquetas): void;
}

/** Métricas que no guardan nada: para pruebas y para quien no recibe unas. */
export const metricasNulas: Metricas = { contar: () => {}, medir: () => {}, fijar: () => {} };

const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;
const MAX_LARGO_DE_ETIQUETA = 64;
/** Sin `,` `=` `{` `}` el valor no puede imitar a otra etiqueta ni romper la clave de la serie. */
const VALOR_DE_ETIQUETA = /^[\w.:/-]*$/;
export const MAX_SERIES = 500;

export interface SerieContada {
  readonly nombre: string;
  readonly etiquetas: Etiquetas;
  readonly valor: number
}
export interface SerieMedida {
  readonly nombre: string;
  readonly etiquetas: Etiquetas;
  readonly cantidad: number;
  readonly suma: number;
  readonly minimo: number;
  readonly maximo: number
}
export interface ResumenDeMetricas {
  readonly contadores: readonly SerieContada[];
  readonly mediciones: readonly SerieMedida[];
  readonly valores: readonly SerieContada[];
  /** Cuántas anotaciones se descartaron: por el tope de `MAX_SERIES` series o (sin modo estricto) por inválidas. */
  readonly descartadas: number;
  /** El nombre de la primera anotación inválida descartada en el período, para encontrar el error; null si no hubo. */
  readonly ejemplo: string | null;
}

function validar(nombre: unknown, etiquetas: Etiquetas | undefined): Etiquetas {
  if (typeof nombre !== "string" || !IDENTIFICADOR.test(nombre) || pareceUnDato(nombre)) throw new RangeError(`nombre de métrica inválido: ${JSON.stringify(nombre)}`);
  if (etiquetas === undefined) return {};
  if (typeof etiquetas !== "object" || etiquetas === null || Array.isArray(etiquetas)) throw new RangeError("las etiquetas deben ser un objeto");
  const copia = { ...etiquetas }; // una sola lectura: un getter no puede devolver otro valor después de validar
  for (const [clave, valor] of Object.entries(copia)) {
    if (!IDENTIFICADOR.test(clave) || pareceUnDato(clave)) throw new RangeError(`nombre de etiqueta inválido: ${JSON.stringify(clave)}`);
    if (typeof valor !== "string" || valor.length > MAX_LARGO_DE_ETIQUETA || !VALOR_DE_ETIQUETA.test(valor) || pareceUnDato(valor)) {
      throw new RangeError(`la etiqueta ${clave} debe ser un texto de hasta ${MAX_LARGO_DE_ETIQUETA} caracteres con letras, números y . : / _ - (que no parezca un dato)`);
    }
  }
  return copia;
}

/** Si un valor parece un nombre y se puede mostrar en el log: solo letras, números, `_` y `-`, y que no parezca un dato. */
const esNombre = (x: unknown): x is string => typeof x === "string" && /^[\w-]+$/.test(x) && !pareceUnDato(x);

const finito = (n: unknown, que: string): number => {
  if (typeof n !== "number" || !Number.isFinite(n)) throw new RangeError(`${que} debe ser un número finito, llegó ${String(n)}`);
  return n;
};

/** Orden por código de carácter, igual en todo entorno (`localeCompare` depende del idioma del sistema y cambiaría las claves). */
const porCodigo = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** La clave de una serie: el nombre y las etiquetas en orden alfabético, como se escribe en el log (`ops_rechazadas{motivo=viaje_cerrado}`). */
export function claveDeSerie(nombre: string, etiquetas: Etiquetas): string {
  const partes = Object.keys(etiquetas).toSorted(porCodigo).map((k) => `${k}=${etiquetas[k]}`);
  return partes.length === 0 ? nombre : `${nombre}{${partes.join(",")}}`;
}

interface Contada { nombre: string; etiquetas: Etiquetas; valor: number }
interface Medida { nombre: string; etiquetas: Etiquetas; cantidad: number; suma: number; minimo: number; maximo: number }

export class MetricasEnMemoria implements Metricas {
  private readonly contadores = new Map<string, Contada>();
  private readonly mediciones = new Map<string, Medida>();
  private readonly valores = new Map<string, Contada>();
  private descartadas = 0;
  private ejemplo: string | null = null;

  /**
   * `estricto` (por defecto): un nombre, una etiqueta o un valor inválido lanza `RangeError` (así los tests lo encuentran).
   * No estricto, para producción: la anotación se descarta y se cuenta en `descartadas`; las métricas no tumban un pedido.
   */
  constructor(
    private readonly maxSeries: number = MAX_SERIES,
    private readonly estricto: boolean = true,
  ) {}

  private anotar(nombre: unknown, accion: () => void): void {
    try {
      accion();
    } catch (e) {
      if (this.estricto) throw e;
      this.descartadas += 1;
      this.ejemplo ??= esNombre(nombre) ? nombre : "[no es un nombre]";
    }
  }

  private hayLugar(mapa: Map<string, unknown>, clave: string): boolean {
    if (mapa.has(clave)) return true;
    // el tope cuenta las series de los tres tipos: una etiqueta mal elegida no debe hacer crecer la memoria sin límite
    if (this.contadores.size + this.mediciones.size + this.valores.size >= this.maxSeries) {
      this.descartadas += 1;
      return false;
    }
    return true;
  }

  contar(nombre: string, valor = 1, etiquetas?: Etiquetas): void { this.anotar(nombre, () => this.contarYa(nombre, valor, etiquetas)); }

  private contarYa(nombre: string, valor: number, etiquetas?: Etiquetas): void {
    const e = validar(nombre, etiquetas);
    if (finito(valor, "el valor") < 0) throw new RangeError("un contador no baja: el valor no puede ser negativo");
    const clave = claveDeSerie(nombre, e);
    if (!this.hayLugar(this.contadores, clave)) return;
    const actual = this.contadores.get(clave);
    if (actual === undefined) this.contadores.set(clave, { nombre, etiquetas: e, valor });
    else actual.valor += valor;
  }

  medir(nombre: string, milisegundos: number, etiquetas?: Etiquetas): void { this.anotar(nombre, () => this.medirYa(nombre, milisegundos, etiquetas)); }

  private medirYa(nombre: string, milisegundos: number, etiquetas?: Etiquetas): void {
    const e = validar(nombre, etiquetas);
    if (finito(milisegundos, "la duración") < 0) throw new RangeError("una duración no puede ser negativa");
    const clave = claveDeSerie(nombre, e);
    if (!this.hayLugar(this.mediciones, clave)) return;
    const actual = this.mediciones.get(clave);
    if (actual === undefined) this.mediciones.set(clave, { nombre, etiquetas: e, cantidad: 1, suma: milisegundos, minimo: milisegundos, maximo: milisegundos });
    else {
      actual.cantidad += 1;
      actual.suma += milisegundos;
      actual.minimo = Math.min(actual.minimo, milisegundos);
      actual.maximo = Math.max(actual.maximo, milisegundos);
    }
  }

  fijar(nombre: string, valor: number, etiquetas?: Etiquetas): void { this.anotar(nombre, () => this.fijarYa(nombre, valor, etiquetas)); }

  private fijarYa(nombre: string, valor: number, etiquetas?: Etiquetas): void {
    const e = validar(nombre, etiquetas);
    finito(valor, "el valor");
    const clave = claveDeSerie(nombre, e);
    if (!this.hayLugar(this.valores, clave)) return;
    this.valores.set(clave, { nombre, etiquetas: e, valor });
  }

  /** Lo acumulado hasta ahora, sin reiniciar nada. */
  resumen(): ResumenDeMetricas {
    const copiar = <T extends { etiquetas: Etiquetas }>(x: T): T => ({ ...x, etiquetas: { ...x.etiquetas } });
    return {
      contadores: [...this.contadores.values()].map(copiar),
      mediciones: [...this.mediciones.values()].map(copiar),
      valores: [...this.valores.values()].map(copiar),
      descartadas: this.descartadas,
      ejemplo: this.ejemplo,
    };
  }

  /**
   * Lo acumulado desde la última vez, y reinicia los contadores, las mediciones y las descartadas (cada resumen cuenta solo
   * su período). Los valores actuales se conservan: siguen siendo ciertos hasta que alguien los vuelva a fijar.
   */
  tomarResumen(): ResumenDeMetricas {
    const r = this.resumen();
    this.contadores.clear();
    this.mediciones.clear();
    this.descartadas = 0;
    this.ejemplo = null;
    return r;
  }
}

/** El resumen como campos de log: una clave por serie (`ops_rechazadas{motivo=viaje_cerrado}`), sin listas anidadas. */
export function resumenACampos(r: ResumenDeMetricas): Record<string, unknown> {
  // un resumen puede fabricarse desde fuera: cada serie se lee UNA vez (un getter no puede cambiar de valor después), se revalida
  // y la que no cumple se omite y se cuenta como descartada
  let omitidas = 0;
  const numero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const agregar = <S extends { nombre: string; etiquetas: Etiquetas }, V>(series: readonly S[], destino: Record<string, V>, valorDe: (s: S) => V | null): void => {
    for (const s of series) {
      try {
        const nombre = s.nombre;
        const clave = claveDeSerie(nombre, validar(nombre, s.etiquetas));
        const valor = valorDe(s);
        if (valor === null) throw new RangeError("la serie debe tener solo números finitos");
        destino[clave] = valor;
      } catch {
        omitidas += 1;
      }
    }
  };
  const unNumero = (s: { valor: number }): number | null => {
    const v = s.valor;
    return numero(v) ? v : null;
  };
  const contadores: Record<string, number> = {};
  agregar(r.contadores, contadores, unNumero);
  const mediciones: Record<string, unknown> = {};
  agregar(r.mediciones, mediciones, (s) => {
    const { cantidad, suma, minimo, maximo } = s;
    return [cantidad, suma, minimo, maximo].every(numero) ? { cantidad, suma, minimo, maximo } : null;
  });
  const valores: Record<string, number> = {};
  agregar(r.valores, valores, unNumero);
  // validado: se marca para que el log no lo trate como texto libre (cortaría las claves)
  return {
    contadores: marcarLimpio(contadores),
    mediciones: marcarLimpio(mediciones),
    valores: marcarLimpio(valores),
    descartadas: (numero(r.descartadas) ? r.descartadas : 0) + omitidas,
    ...(r.ejemplo === null ? {} : { ejemplo_descartada: esNombre(r.ejemplo) ? r.ejemplo : "[no es un nombre]" }),
  };
}

export const CADA_HORA_MS = 60 * 60 * 1000;

export interface OpcionesDelResumen {
  readonly metricas: MetricasEnMemoria;
  readonly registro: Registro;
  readonly cadaMs?: number;
  /** Para pruebas: reemplazan a `setInterval` y `clearInterval`. */
  readonly programar?: (accion: () => void, cadaMs: number) => unknown;
  readonly cancelar?: (temporizador: unknown) => void;
}

/** Imprime el resumen en el log (`metricas_resumen`) cada `cadaMs` (una hora). Devuelve la función que lo detiene. */
export function iniciarResumenPeriodico(opciones: OpcionesDelResumen): () => void {
  const cadaMs = opciones.cadaMs ?? CADA_HORA_MS;
  if (!Number.isFinite(cadaMs) || cadaMs <= 0) throw new RangeError("el intervalo del resumen debe ser un número positivo");
  const programar = opciones.programar ?? ((accion, ms) => setInterval(accion, ms));
  const cancelar = opciones.cancelar ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));
  const temporizador = programar(() => {
    try {
      opciones.registro.info("metricas_resumen", resumenACampos(opciones.metricas.tomarResumen()));
    } catch {
      /* un fallo al escribir el resumen no debe tumbar el proceso: el próximo intento sigue */
    }
  }, cadaMs);
  // un temporizador que solo imprime un resumen no debe impedir que el proceso termine
  if (typeof temporizador === "object" && temporizador !== null && "unref" in temporizador && typeof temporizador.unref === "function") temporizador.unref();
  return () => cancelar(temporizador);
}

/** Empieza a medir una duración; la función devuelta la anota con `medir` y la devuelve (en milisegundos). */
export function iniciarMedicion(metricas: Metricas, nombre: string, etiquetas?: Etiquetas, reloj: () => number = () => performance.now()): () => number {
  const inicio = reloj();
  return () => {
    const ms = Math.max(0, reloj() - inicio);
    metricas.medir(nombre, ms, etiquetas);
    return ms;
  };
}
