// Comandos de administración (se usan con `docker exec cuaderno-server node dist/admin.js <comando>`): cada uno
// devuelve las líneas que se muestran. Corren en otro proceso que el servidor, sobre la misma base.

import type { Database } from "better-sqlite3";
import { AlmacenSqlite } from "../almacen/operaciones/almacenSqlite.js";
import { estadoDelViaje } from "../dominio/base/estadoViaje.js";
import { planDelViaje } from "../dominio/operaciones/cierreViaje.js";
import type { ServicioDeIdentidad } from "../dominio/identidad/servicioIdentidad.js";

export interface EntornoDeAdministracion {
  readonly db: Database;
  readonly servicio: ServicioDeIdentidad;
  readonly ahora: () => number;
}

/** Un comando o una opción mal escrita: se muestra con la ayuda. */
export class ErrorDeUso extends Error {}

export const AYUDA = [
  "uso: node dist/admin.js <comando> [opciones]",
  "  viajes                                            lista los viajes con su estado, integrantes y dispositivos (con sus ids)",
  "  invitar --viaje <id> [--reemplaza <integrante>]   emite una invitación de rescate (vale 24 h)",
  "  revocar --dispositivo <id>                        revoca un dispositivo",
  "  ayuda                                             muestra esta ayuda",
];

/** `ayuda` o `--help`: se muestra la ayuda y sale bien. */
export const esPedidoDeAyuda = (argv: readonly string[]): boolean => argv.length === 1 && (argv[0] === "ayuda" || argv[0] === "--help");

const OPCIONES: Readonly<Record<string, readonly string[]>> = {
  viajes: [],
  invitar: ["viaje", "reemplaza"],
  revocar: ["dispositivo"],
};

/** Separa el comando de sus opciones `--nombre valor`; rechaza opciones desconocidas, repetidas o sin valor. */
export function leerArgumentos(argv: readonly string[]): { readonly comando: string; readonly opciones: ReadonlyMap<string, string> } {
  const [comando, ...resto] = argv;
  if (comando === undefined || comando === "") throw new ErrorDeUso("falta el comando");

  const permitidas = OPCIONES[comando];
  if (permitidas === undefined || !Object.hasOwn(OPCIONES, comando)) throw new ErrorDeUso(`comando desconocido: ${comando}`);

  const opciones = new Map<string, string>();
  for (let i = 0; i < resto.length; i += 2) {
    const nombre = resto[i] ?? "";
    const valor = resto[i + 1];
    if (!nombre.startsWith("--")) throw new ErrorDeUso(`se esperaba una opción --nombre y llegó: ${nombre}`);
    const clave = nombre.slice(2);
    if (!permitidas.includes(clave)) throw new ErrorDeUso(`opción desconocida para ${comando}: ${nombre}`);
    if (opciones.has(clave)) throw new ErrorDeUso(`opción repetida: ${nombre}`);
    if (valor === undefined || valor === "" || valor.startsWith("--")) throw new ErrorDeUso(`falta el valor de ${nombre}`);

    opciones.set(clave, valor);
  }
  return { comando, opciones };
}

const fecha = (ms: number): string => new Date(ms).toISOString();

function obligatoria(opciones: ReadonlyMap<string, string>, clave: string): string {
  const valor = opciones.get(clave);
  if (valor === undefined) throw new ErrorDeUso(`falta --${clave}`);
  return valor;
}

function viajes(db: Database, ahoraMs: number): string[] {
  const ids = (db.prepare("SELECT id FROM entity WHERE tipo = 'trip' ORDER BY id").all() as { id: string }[]).map((f) => f.id);
  if (ids.length === 0) return ["no hay viajes"];
  return ids.flatMap((id) => {
    const almacen = new AlmacenSqlite(db, id);
    const plan = planDelViaje(almacen, id);
    const estado = plan === null ? "?" : estadoDelViaje(plan, ahoraMs);
    const o = db.prepare("SELECT COUNT(*) AS n, MAX(aceptada_en) AS ultima FROM op WHERE trip_id = ?").get(id) as { n: number; ultima: number | null };
    const ultima = o.ultima === null ? "sin operaciones" : `última ${fecha(o.ultima)}`;
    const integrantes = (db.prepare("SELECT id FROM entity WHERE trip_id = ? AND tipo = 'member' ORDER BY id").all(id) as { id: string }[]).map((m) => {
      const organizador = almacen.leerCampo("member", m.id, "es_organizador") === 1 ? "  organizador" : "";
      return `  integrante ${m.id}  ${JSON.stringify(almacen.leerCampo("member", m.id, "apodo") ?? "")}${organizador}`;
    });
    const dispositivos = (db.prepare("SELECT device_id, member_id, nombre, revocado_en FROM device WHERE trip_id = ? ORDER BY creado_en, device_id").all(id) as {
      device_id: string;
      member_id: string;
      nombre: string;
      revocado_en: number | null;
    }[]).map((d) => `  dispositivo ${d.device_id}  ${JSON.stringify(d.nombre)}  de ${d.member_id}  ${d.revocado_en === null ? "activo" : `revocado ${fecha(d.revocado_en)}`}`);
    return [`viaje ${id}  ${JSON.stringify(almacen.leerCampo("trip", id, "nombre") ?? "")}  ${estado}  operaciones ${o.n}  ${ultima}`, ...integrantes, ...dispositivos];
  });
}

/** Ejecuta un comando ya leído. Los errores del servicio (`ErrorDeServicio`) y de uso se propagan. */
export function ejecutar(argv: readonly string[], entorno: EntornoDeAdministracion): string[] {
  const { comando, opciones } = leerArgumentos(argv);
  switch (comando) {
    case "viajes":
      // una sola lectura: el servidor puede estar escribiendo al mismo tiempo
      return entorno.db.transaction(() => viajes(entorno.db, entorno.ahora()))();
    case "invitar": {
      const emitida = entorno.servicio.invitarComoAdministrador(obligatoria(opciones, "viaje"), opciones.get("reemplaza") ?? null);
      return [`código: ${emitida.codigo}`, `vence: ${fecha(emitida.venceEn)}`];
    }
    case "revocar": {
      const { dispositivo: d, yaEstaba } = entorno.servicio.revocarComoAdministrador(obligatoria(opciones, "dispositivo"));
      const quien = `${d.deviceId} (${JSON.stringify(d.nombre)}) del viaje ${d.tripId}`;
      return yaEstaba ? [`ya estaba revocado: ${quien}`] : [`revocado: ${quien}`, "si estaba conectado en vivo, lo nota al reconectar (y desde ahí recibe 401)"];
    }
    default:
      throw new ErrorDeUso(`comando desconocido: ${comando}`);
  }
}
