// Validación de formato de una operación, sin mirar el estado: tipo conocido, campos permitidos para ese
// tipo, campos obligatorios, y el tipo, el rango y el formato de cada valor. Es una función pura.
// Lo que depende del estado (viaje cerrado, límites, referencias a otras entidades) se valida aparte.
// Todo rechazo de esta validación es de razón `formato`.

import { MAX_MONTO_MINOR } from "../base/dinero.js";
import type { Campos, Json, Operacion } from "./operaciones.js";
import { MAX_MS, parsearHlc } from "../base/reloj.js";

export type ResultadoValidacion =
  | { readonly ok: true }
  | { readonly ok: false; readonly campo: string; readonly motivo: string };

/** Devuelve el motivo del rechazo, o null si el valor es válido. */
type Regla = (valor: Json) => string | null;

/** Tamaños máximos de los adjuntos, en bytes. */
export const MAX_BYTES_IMAGEN = 5 * 1024 * 1024;
export const MAX_BYTES_PDF = 10 * 1024 * 1024;

const es = (v: Json): v is { readonly [k: string]: Json } => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- reglas de valor -------------------------------------------------------------------------------

function entero(min: number, max: number): Regla {
  return (v) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || Object.is(v, -0)) return "debe ser un entero";
    return v < min || v > max ? `debe estar entre ${min} y ${max}` : null;
  };
}

const exacto = (n: number): Regla => (v) => (v === n && !Object.is(v, -0) ? null : `debe ser ${n}`);
const binario: Regla = (v) => (v === 0 || v === 1 ? (Object.is(v, -0) ? "debe ser 0 o 1" : null) : "debe ser 0 o 1");
const momento: Regla = entero(0, MAX_MS);

/** Caracteres de control: en un texto de una línea, todos; en uno de varias líneas, todos salvo tabulador y salto. */
const CONTROLES = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROLES_SALVO_TAB_Y_SALTO = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
/** Unidad UTF-16 suelta: un sustituto alto sin bajo detrás, o un bajo sin alto delante. */
const SUSTITUTO_SUELTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const SOLO_ESPACIOS = /^[ \t\n]*$/;

function texto(max: number, variasLineas = false): Regla {
  const controles = variasLineas ? CONTROLES_SALVO_TAB_Y_SALTO : CONTROLES;
  return (v) => {
    if (typeof v !== "string") return "debe ser texto";
    if (v.length < 1 || v.length > max) return `debe tener entre 1 y ${max} caracteres`;
    if (controles.test(v)) return "no admite caracteres de control";
    if (SUSTITUTO_SUELTO.test(v)) return "no admite unidades Unicode sueltas";
    return SOLO_ESPACIOS.test(v) ? "no puede ser solo espacios" : null;
  };
}

/** La regla de los textos de una línea (apodo, nombres), para quien necesite la misma fuera de las operaciones. Devuelve el motivo del rechazo o null. */
export function validarTextoDeUnaLinea(valor: unknown, max: number): string | null {
  return texto(max)(valor as Json); // la regla ya comprueba que sea texto
}

function conPatron(patron: RegExp, descripcion: string): Regla {
  return (v) => (typeof v === "string" && patron.test(v) ? null : `debe ser ${descripcion}`);
}

const uuid = conPatron(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "un UUID en minúsculas");
const uuidOOtro: Regla = (v) => (v === "otro" ? null : uuid(v));
const codigoMoneda = conPatron(/^[A-Z]{3}$/, "un código de moneda de tres letras mayúsculas");
const color = conPatron(/^#[0-9A-F]{6}$/, "un color #RRGGBB en mayúsculas");
const metodoPago = conPatron(/^[A-Z][A-Z0-9_]{0,31}$/, "un código de método de pago");
const sha256 = conPatron(/^[0-9a-f]{64}$/, "un SHA-256 en hexadecimal minúscula");
const enlace = (v: Json): string | null =>
  typeof v === "string" && v.length <= 500 && /^https?:\/\/\S+$/.test(v) ? null : "debe ser un enlace http o https de hasta 500 caracteres";

function enumerado(...valores: string[]): Regla {
  return (v) => (typeof v === "string" && valores.includes(v) ? null : `debe ser uno de ${valores.join(", ")}`);
}

function numeroEntre(min: number, max: number): Regla {
  return (v) => (typeof v === "number" && !Object.is(v, -0) && v >= min && v <= max ? null : `debe ser un número entre ${min} y ${max}`);
}

const DIAS_DEL_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const fecha: Regla = (v) => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (m === null) return "debe ser una fecha AAAA-MM-DD";
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const diasDelMes = DIAS_DEL_MES[mes - 1];
  // años acotados: Date.UTC toma 0–99 como 19xx y el año 10000 no se puede escribir
  if (anio < 1900 || anio > 2999) return "debe ser una fecha entre 1900 y 2999";
  if (diasDelMes === undefined) return "debe ser una fecha que exista";
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
  const ultimo = diasDelMes + (mes === 2 && bisiesto ? 1 : 0);
  return dia >= 1 && dia <= ultimo ? null : "debe ser una fecha que exista";
};

/** Forma `Continente/Ciudad`: rechaza `UTC`, `EST` y desfases como `+01:00`. Intl no distingue mayúsculas en el resto. */
const FORMA_DE_ZONA = /^[A-Z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+)+$/;

const zonaHoraria: Regla = (v) => {
  if (typeof v !== "string" || !FORMA_DE_ZONA.test(v)) return "debe ser una zona horaria IANA con la forma Continente/Ciudad";
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return null;
  } catch {
    return "debe ser una zona horaria IANA";
  }
};

/** Acepta null además de lo que acepte la regla: en una edición, null borra el campo opcional. */
const anulable = (regla: Regla): Regla => (v) => (v === null ? null : regla(v));

const listaDeMonedas: Regla = (v) => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 10) return "debe ser una lista de 1 a 10 monedas";
  const vistos = new Set<string>();
  for (const m of v as readonly Json[]) {
    if (!es(m)) return "cada moneda debe ser un objeto";
    if (Object.keys(m).some((k) => k !== "codigo" && k !== "decimales" && k !== "simbolo")) return "una moneda trae campos que no corresponden";
    const error = codigoMoneda(m.codigo ?? null) ?? decimales(m.decimales ?? null) ?? simbolo(m.simbolo ?? null);
    if (error !== null) return `moneda inválida: ${error}`;
    if (vistos.has(m.codigo as string)) return "hay monedas repetidas";
    vistos.add(m.codigo as string);
  }
  return null;
};

const decimales: Regla = entero(0, 4);
const simbolo: Regla = texto(8);
const nombre: Regla = texto(100);
const textoCorto: Regla = texto(200);
const nota: Regla = texto(2000, true);
const emoji: Regla = texto(32);
const apodo: Regla = texto(40);
const montoPositivo: Regla = entero(1, MAX_MONTO_MINOR);
const montoNoNegativo: Regla = entero(0, MAX_MONTO_MINOR);

// ---- esquemas por tipo de operación ----------------------------------------------------------------

interface ErrorDeCampo {
  readonly campo: string;
  readonly motivo: string;
}

interface Esquema {
  readonly entidad: string;
  readonly id: Regla;
  readonly campos: { readonly [campo: string]: Regla };
  /** Campos que deben venir (y, salvo que la regla acepte null, no pueden ser null). */
  readonly obligatorios: readonly string[];
  /** Una edición debe traer al menos un campo. */
  readonly minimoUno?: boolean;
  /** Reglas que miran varios campos a la vez. */
  readonly cruzada?: (op: Operacion) => ErrorDeCampo | null;
}

const fechasEnOrden = (op: Operacion): ErrorDeCampo | null => {
  const { fecha_inicio: ini, fecha_fin: fin } = op.payload;
  return typeof ini === "string" && typeof fin === "string" && fin < ini ? { campo: "fecha_fin", motivo: "no puede ser anterior a fecha_inicio" } : null;
};

const ubicacionEnPareja = (op: Operacion): ErrorDeCampo | null => {
  const p = op.payload;
  const [tieneLat, tieneLon] = [Object.hasOwn(p, "lat"), Object.hasOwn(p, "lon")];
  if (tieneLat !== tieneLon) return { campo: "lat", motivo: "lat y lon deben venir juntos" };
  return tieneLat && (p.lat === null) !== (p.lon === null) ? { campo: "lat", motivo: "lat y lon deben ser ambos números o ambos null" } : null;
};

const CAMPOS_GASTO = {
  monto_minor: montoPositivo,
  moneda: codigoMoneda,
  categoria_id: uuidOOtro,
  cuando_ocurrio: momento,
  dia_imputado: fecha,
  concepto: anulable(textoCorto),
  lugar: anulable(textoCorto),
  metodo_pago: anulable(metodoPago),
  alias_tarjeta: anulable(textoCorto),
  nota: anulable(nota),
};

const CAMPOS_UBICACION = {
  lat: anulable(numeroEntre(-90, 90)),
  lon: anulable(numeroEntre(-180, 180)),
  precision_m: anulable(numeroEntre(0, 100000)),
  ubicacion_tomada_en: anulable(momento),
};

const CAMPOS_FIJO = {
  nombre,
  moneda: codigoMoneda,
  monto_unitario_minor: montoNoNegativo,
  cantidad: entero(1, 100000),
  unidad: anulable(textoCorto),
  metodo_pago: anulable(metodoPago),
  alias_tarjeta: anulable(textoCorto),
  lugar: anulable(textoCorto),
  enlace_mapa: anulable(enlace),
  nota: anulable(nota),
};

const CAMPOS_ATAJO = {
  nombre,
  monto_minor: montoPositivo,
  moneda: codigoMoneda,
  categoria_id: uuidOOtro,
  metodo_pago: anulable(metodoPago),
  alias_tarjeta: anulable(textoCorto),
  lugar: anulable(textoCorto),
  orden: entero(0, 1000000),
};

const CAMPOS_EFECTIVO = {
  cuando: momento,
  nota: anulable(nota),
  moneda_sale: codigoMoneda,
  monto_sale_minor: montoPositivo,
  moneda_entra: codigoMoneda,
  monto_entra_minor: montoPositivo,
  moneda_ajuste: codigoMoneda,
  saldo_ajuste_minor: montoNoNegativo,
};

/** Campos de dinero que lleva cada tipo de movimiento de efectivo. */
export const DINERO_DEL_MOVIMIENTO: { readonly [tipo: string]: readonly string[] } = {
  CAMBIO: ["moneda_sale", "monto_sale_minor", "moneda_entra", "monto_entra_minor"],
  RETIRO: ["moneda_entra", "monto_entra_minor"],
  AJUSTE: ["moneda_ajuste", "saldo_ajuste_minor"],
};

const movimientoCoherente = (op: Operacion): ErrorDeCampo | null => {
  const p = op.payload;
  const esperados = DINERO_DEL_MOVIMIENTO[p.tipo as string] ?? [];
  const presentes = Object.keys(p).filter((k) => k !== "tipo" && k !== "cuando" && k !== "nota");
  if (presentes.length !== esperados.length || presentes.some((k) => !esperados.includes(k))) {
    return { campo: "tipo", motivo: `un movimiento ${String(p.tipo)} lleva exactamente ${esperados.join(", ")}` };
  }
  return p.tipo === "CAMBIO" && p.moneda_sale === p.moneda_entra ? { campo: "moneda_entra", motivo: "un cambio necesita dos monedas distintas" } : null;
};

const adjuntoCoherente = (op: Operacion): ErrorDeCampo | null => {
  const { mime, bytes } = op.payload;
  const tope = mime === "application/pdf" ? MAX_BYTES_PDF : MAX_BYTES_IMAGEN;
  return typeof bytes === "number" && bytes > tope ? { campo: "bytes", motivo: `un ${String(mime)} no puede pasar de ${tope} bytes` } : null;
};

const totalDelFijo = (op: Operacion): ErrorDeCampo | null => {
  const { monto_unitario_minor: unitario, cantidad } = op.payload;
  if (typeof unitario === "number" && typeof cantidad === "number" && unitario * cantidad > MAX_MONTO_MINOR) {
    return { campo: "cantidad", motivo: "el total (monto por unidad por cantidad) es demasiado grande" };
  }
  return ubicacionEnPareja(op);
};

const noArchivarOtro = (op: Operacion): ErrorDeCampo | null =>
  op.entidadId === "otro" && op.payload.archivada === 1 ? { campo: "archivada", motivo: "la categoría Otro no se archiva" } : null;

const vacio = (entidad: string, id: Regla): Esquema => ({ entidad, id, campos: {}, obligatorios: [] });

const ESQUEMAS: ReadonlyMap<string, Esquema> = new Map<string, Esquema>([
  ["trip.create", { entidad: "trip", id: uuid, campos: { nombre, zona_horaria: zonaHoraria, fecha_inicio: anulable(fecha), fecha_fin: anulable(fecha), monedas: listaDeMonedas }, obligatorios: ["nombre", "zona_horaria", "monedas"], cruzada: fechasEnOrden }],
  ["trip.update", { entidad: "trip", id: uuid, campos: { nombre, zona_horaria: zonaHoraria, fecha_inicio: anulable(fecha), fecha_fin: anulable(fecha), objetivos: anulable(nota), estado_manual: anulable(enumerado("EN_CURSO", "CERRADO")) }, obligatorios: [], minimoUno: true, cruzada: fechasEnOrden }],
  ["currency.enable", { entidad: "trip_currency", id: codigoMoneda, campos: { habilitada: exacto(1), decimales, simbolo }, obligatorios: ["habilitada", "decimales", "simbolo"] }],
  ["currency.disable", { entidad: "trip_currency", id: codigoMoneda, campos: { habilitada: exacto(0) }, obligatorios: ["habilitada"] }],
  ["currency.update", { entidad: "trip_currency", id: codigoMoneda, campos: { tope_minor: anulable(montoNoNegativo), efectivo_inicial_minor: anulable(montoNoNegativo) }, obligatorios: [], minimoUno: true }],
  ["member.join", { entidad: "member", id: uuid, campos: { apodo, color, emoji, es_organizador: binario }, obligatorios: ["apodo", "color", "emoji", "es_organizador"] }],
  ["member.update", { entidad: "member", id: uuid, campos: { apodo, color, emoji }, obligatorios: [], minimoUno: true }],
  ["category.create", { entidad: "category", id: uuidOOtro, campos: { nombre, color, emoji }, obligatorios: ["nombre", "color", "emoji"] }],
  ["category.update", { entidad: "category", id: uuidOOtro, campos: { nombre, color, emoji }, obligatorios: [], minimoUno: true }],
  ["category.archive", { entidad: "category", id: uuidOOtro, campos: { archivada: binario }, obligatorios: ["archivada"], cruzada: noArchivarOtro }],
  ["expense.create", { entidad: "expense", id: uuid, campos: CAMPOS_GASTO, obligatorios: ["monto_minor", "moneda", "categoria_id", "cuando_ocurrio", "dia_imputado"] }],
  ["expense.update", { entidad: "expense", id: uuid, campos: { ...CAMPOS_GASTO, ...CAMPOS_UBICACION }, obligatorios: [], minimoUno: true, cruzada: ubicacionEnPareja }],
  ["expense.delete", { entidad: "expense", id: uuid, campos: { eliminado: exacto(1) }, obligatorios: ["eliminado"] }],
  ["expense.restore", { entidad: "expense", id: uuid, campos: { eliminado: exacto(0) }, obligatorios: ["eliminado"] }],
  ["expense.purge", vacio("expense", uuid)],
  ["fixed.create", { entidad: "fixed_cost", id: uuid, campos: { ...CAMPOS_FIJO, lat: CAMPOS_UBICACION.lat, lon: CAMPOS_UBICACION.lon }, obligatorios: ["nombre", "moneda", "monto_unitario_minor", "cantidad"], cruzada: totalDelFijo }],
  ["fixed.update", { entidad: "fixed_cost", id: uuid, campos: { ...CAMPOS_FIJO, lat: CAMPOS_UBICACION.lat, lon: CAMPOS_UBICACION.lon, pagado_en: anulable(momento) }, obligatorios: [], minimoUno: true, cruzada: totalDelFijo }],
  ["fixed.delete", vacio("fixed_cost", uuid)],
  ["attachment.add", { entidad: "attachment", id: uuid, campos: { owner_tipo: enumerado("EXPENSE", "FIXED_COST"), owner_id: uuid, mime: enumerado("image/jpeg", "image/png", "image/webp", "application/pdf"), bytes: entero(1, MAX_BYTES_PDF), sha256, tiene_miniatura: binario }, obligatorios: ["owner_tipo", "owner_id", "mime", "bytes", "sha256", "tiene_miniatura"], cruzada: adjuntoCoherente }],
  ["attachment.remove", { entidad: "attachment", id: uuid, campos: { quitado: exacto(1) }, obligatorios: ["quitado"] }],
  ["shortcut.create", { entidad: "shortcut", id: uuid, campos: CAMPOS_ATAJO, obligatorios: ["nombre", "monto_minor", "moneda", "categoria_id", "orden"] }],
  ["shortcut.update", { entidad: "shortcut", id: uuid, campos: CAMPOS_ATAJO, obligatorios: [], minimoUno: true }],
  ["shortcut.delete", vacio("shortcut", uuid)],
  ["cashmove.create", { entidad: "cash_movement", id: uuid, campos: { tipo: enumerado("CAMBIO", "RETIRO", "AJUSTE"), ...CAMPOS_EFECTIVO }, obligatorios: ["tipo", "cuando"], cruzada: movimientoCoherente }],
  ["cashmove.update", { entidad: "cash_movement", id: uuid, campos: CAMPOS_EFECTIVO, obligatorios: [], minimoUno: true }],
  ["cashmove.delete", vacio("cash_movement", uuid)],
]);

// ---- validación ------------------------------------------------------------------------------------

const fallo = (campo: string, motivo: string): ResultadoValidacion => ({ ok: false, campo, motivo });

/** La versión del formato de las operaciones que genera este servidor (la de la app actual). */
export const VERSION_DE_FORMATO = 1;

/** Las versiones del formato que el servidor entiende (la actual y, cuando haya, la anterior). */
export const VERSIONES_DE_FORMATO: readonly number[] = [VERSION_DE_FORMATO];

/** Valida el formato de una operación recibida (sin mirar el estado). Los rechazos son de razón `formato`. */
export function validarOperacion(op: Operacion): ResultadoValidacion {
  if (typeof op.tipo !== "string") return fallo("tipo", "debe ser texto");
  const esquema = ESQUEMAS.get(op.tipo);
  if (esquema === undefined) return fallo("tipo", "tipo de operación desconocido");
  if (op.entidadTipo !== esquema.entidad) return fallo("entidadTipo", `una operación ${op.tipo} es de ${esquema.entidad}`);
  if (uuid(op.opId ?? null) !== null) return fallo("opId", "debe ser un UUID en minúsculas");
  const errorId = esquema.id(op.entidadId ?? null);
  if (errorId !== null) return fallo("entidadId", errorId);
  if (typeof op.hlc !== "string" || !parsearHlc(op.hlc).ok) return fallo("hlc", "debe ser una marca válida");
  if (!es(op.payload as Json)) return fallo("payload", "debe ser un objeto");
  if (!(VERSIONES_DE_FORMATO as readonly unknown[]).includes(op.schemaVersion)) return fallo("schemaVersion", "versión de formato que este servidor no entiende");

  const payload: Campos = op.payload;
  for (const clave of Object.keys(payload)) {
    // propiedades propias: `constructor`, `toString` y `__proto__` no son campos aunque todo objeto los tenga
    if (!Object.hasOwn(esquema.campos, clave)) return fallo(clave.slice(0, 64), "campo que no corresponde a esta operación");
  }
  for (const clave of esquema.obligatorios) {
    if (!Object.hasOwn(payload, clave)) return fallo(clave, "campo obligatorio");
  }
  for (const [clave, regla] of Object.entries(esquema.campos)) {
    if (!Object.hasOwn(payload, clave)) continue;
    const motivo = regla(payload[clave] as Json);
    if (motivo !== null) return fallo(clave, motivo);
  }
  if (esquema.minimoUno === true && Object.keys(payload).length === 0) return fallo("payload", "una edición debe traer al menos un campo");
  const cruzado = esquema.cruzada?.(op) ?? null;
  return cruzado === null ? { ok: true } : fallo(cruzado.campo, cruzado.motivo);
}
