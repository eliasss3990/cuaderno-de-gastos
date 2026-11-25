// Prueba de humo del despliegue contra el servidor que corre: crea un viaje `humo-<fecha>`, sube una operación, la baja
// y comprueba la salud; al final borra el viaje aunque algo haya fallado. No usa secretos (el token vive solo acá).

import type { Database } from "better-sqlite3";
import { formatearHlc } from "../dominio/base/reloj.js";
import { uuidV7 } from "../dominio/identidad/credenciales.js";
import { VERSION_DE_FORMATO } from "../dominio/operaciones/validacion.js";
import { borrarViaje } from "./borrarViaje.js";

export class FalloDeHumo extends Error {}

/** Cada pedido de humo espera a lo sumo esto: un servidor colgado no debe frenar el despliegue por minutos. */
export const ESPERA_DE_HUMO_MS = 10_000;

export interface DependenciasDeHumo {
  readonly db: Database;
  readonly puerto: number;
  readonly dirAdjuntos: string;
  readonly ahora: () => number;
  readonly pedir?: typeof fetch;
  /** Por defecto `ESPERA_DE_HUMO_MS` (las pruebas la acortan). */
  readonly esperaMs?: number;
}

async function json(r: Response, paso: string, esperado: number): Promise<Record<string, unknown>> {
  if (r.status !== esperado) {
    // el mensaje de error del servidor ayuda a saber qué falló (nunca trae secretos)
    const mensaje = await r
      .json()
      .then((c: { error?: { mensaje?: unknown } }) => (typeof c.error?.mensaje === "string" ? `: ${c.error.mensaje}` : ""))
      .catch(() => "");
    throw new FalloDeHumo(`${paso}: respondió ${r.status} (se esperaba ${esperado})${mensaje}`);
  }
  return (await r.json()) as Record<string, unknown>;
}

export async function humo(dep: DependenciasDeHumo): Promise<string[]> {
  const base = `http://127.0.0.1:${dep.puerto}`;
  const espera = dep.esperaMs ?? ESPERA_DE_HUMO_MS;
  const pedirSinLimite = dep.pedir ?? fetch;
  const pedir: typeof fetch = async (url, init) => {
    try {
      return await pedirSinLimite(url, { ...init, signal: AbortSignal.timeout(espera) });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new FalloDeHumo(`${String(url).replace(base, "")}: no respondió en ${espera} ms`);
      throw e;
    }
  };
  const lineas: string[] = [];
  const salud = await json(await pedir(`${base}/healthz`), "salud", 200);
  lineas.push(`salud: ${String(salud.estado)}`);
  const ahora = dep.ahora();
  const nombre = `humo-${new Date(ahora).toISOString()}`;
  const alta = await json(
    await pedir(`${base}/v1/trips`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre, zona_horaria: "America/Asuncion", monedas: [{ codigo: "PYG", decimales: 0, simbolo: "₲" }], nombre_dispositivo: "humo", apodo: "humo", color: "#E8E4F3", emoji: "🧪" }),
    }),
    "crear el viaje",
    201,
  );
  const tripId = String(alta.trip_id);
  lineas.push(`viaje creado: ${nombre}`);
  let falloOriginal: unknown = null;
  try {
    const cabeceras = { "content-type": "application/json", authorization: `Bearer ${String(alta.token)}` };
    const op = {
      op_id: uuidV7(ahora),
      type: "category.create",
      entity_type: "category",
      entity_id: uuidV7(ahora),
      // contador 2: si el servidor creó el viaje en este mismo milisegundo, ya usó (hora, 0) y (hora, 1) de este dispositivo
      hlc: formatearHlc({ ms: ahora, contador: 2, dispositivo: String(alta.device_id) }),
      payload: { nombre: "humo", color: "#E8E4F3", emoji: "🧪" },
      schema_version: VERSION_DE_FORMATO,
    };
    const subida = await json(await pedir(`${base}/v1/trips/${tripId}/ops`, { method: "POST", headers: cabeceras, body: JSON.stringify({ ops: [op] }) }), "subir", 200);
    const resultado = (subida.resultados as { estado?: string; razon?: string }[] | undefined)?.[0];
    if (resultado?.estado !== "accepted") throw new FalloDeHumo(`subir: la operación quedó ${String(resultado?.estado)}${resultado?.razon === undefined ? "" : ` (${resultado.razon})`}`);
    lineas.push("operación subida");
    const bajada = await json(await pedir(`${base}/v1/trips/${tripId}/changes`, { headers: cabeceras }), "bajar", 200);
    if (!(bajada.ops as { op_id?: string }[] | undefined)?.some((o) => o.op_id === op.op_id)) throw new FalloDeHumo("bajar: la operación subida no aparece en /changes");
    lineas.push("operación bajada");
  } catch (e) {
    falloOriginal = e;
  }
  // se borra aunque algo haya fallado; si el borrado también falla, se informan los dos (el primero es el que importa)
  try {
    await borrarViaje(dep.db, tripId, dep.dirAdjuntos);
  } catch (e) {
    const antes = falloOriginal instanceof Error ? `${falloOriginal.message}; ` : "";
    throw new FalloDeHumo(`${antes}no se pudo borrar el viaje ${tripId} (borrarlo con borrar-viaje --id ${tripId}): ${(e as Error).message}`);
  }
  if (falloOriginal !== null) throw falloOriginal;
  lineas.push("viaje de humo borrado", "humo: ok");
  return lineas;
}
