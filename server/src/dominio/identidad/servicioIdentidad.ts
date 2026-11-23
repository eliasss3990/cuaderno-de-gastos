// Servicio de identidad del servidor: crear un viaje con su primer dispositivo y autenticar a un dispositivo por su token.
// No sabe de HTTP: lanza `ErrorDeServicio` con un código que la API traduce a su respuesta. Todo lo que escribe va en una
// sola transacción del repositorio de identidad (los almacenes de los viajes comparten su conexión), así que un viaje, sus
// dos primeras operaciones y su dispositivo quedan todos o ninguno.

import { aleatorioDelSistema, generarToken, huellaDeToken, uuidV7, type Aleatorio } from "./credenciales.js";
import type { Dispositivo, RepositorioDeIdentidad } from "./identidad.js";
import { MotorOperaciones, type Almacen, type Campos, type Json, type Operacion } from "../operaciones/operaciones.js";
import { formatearHlc } from "../base/reloj.js";
import { validarOperacion, validarTextoDeUnaLinea } from "../operaciones/validacion.js";

export type CodigoDeError =
  | "formato_invalido"
  | "no_autorizado"
  | "dispositivo_revocado"
  | "solo_organizador"
  | "no_existe"
  | "codigo_invalido"
  | "viaje_completo"
  | "demasiados_intentos";

/** Un error esperado del servicio, con el código que la API convierte en su respuesta. */
export class ErrorDeServicio extends Error {
  constructor(
    readonly codigo: CodigoDeError,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorDeServicio";
  }
}

export const MAX_DISPOSITIVOS_ACTIVOS = 4;
/** Un token tiene 43 caracteres: más que esto no puede ser uno y no vale la pena hashearlo. */
const MAX_LARGO_DEL_TOKEN = 256;
const MAX_LARGO_DEL_NOMBRE_DE_DISPOSITIVO = 40;

export interface DatosCrearViaje {
  readonly nombre: string;
  readonly zonaHoraria: string;
  readonly fechaInicio?: string | null;
  readonly fechaFin?: string | null;
  readonly monedas: readonly { readonly codigo: string; readonly decimales: number; readonly simbolo: string }[];
  readonly nombreDispositivo: string;
  readonly apodo: string;
  readonly color: string;
  readonly emoji: string;
}

/** Lo que recibe quien crea un viaje o se une: el token se entrega una sola vez, nunca se guarda. */
export interface Alta {
  readonly tripId: string;
  readonly deviceId: string;
  readonly memberId: string;
  readonly token: string;
}

/**
 * Lo que necesita el servicio. Quien arme el servidor debe armarlo con `servicioDeIdentidadSobre` (src/almacen/identidad/servicioSqlite.ts),
 * que crea el repositorio de identidad y los almacenes sobre la MISMA conexión (todavía no hay un arranque del servidor que lo
 * use: hoy lo usan solo las pruebas). Armarlo a mano con conexiones distintas rompe la
 * atomicidad y el servicio no puede comprobarlo: con dos bases distintas un fallo al crear el dispositivo deja el viaje
 * escrito (un viaje huérfano); con un mismo archivo y dos conexiones las escrituras fallan por bloqueo sin dejar nada.
 * Además, si quien llama ya abrió una transacción en esa conexión, `crearViaje` se une a ella y deshacerla es cosa suya.
 * Los errores de programación o del servidor (un reloj inválido, una operación propia que no se acepta) salen como
 * `RangeError` o `Error` y no como `ErrorDeServicio`: la API los traduce a un error interno y no a una respuesta del cliente.
 */
export interface Dependencias {
  readonly identidad: RepositorioDeIdentidad;
  /** El almacén de un viaje; debe usar la misma conexión que `identidad` para compartir la transacción. */
  readonly almacenDe: (tripId: string) => Almacen;
  /** Reloj del servidor, en milisegundos. */
  readonly ahora: () => number;
  readonly aleatorio?: Aleatorio;
}

/** Lo que informa un celular en cada pedido (`X-Ultimo-Seq` y `X-Pendientes`); lo inválido se ignora. */
export interface Visto {
  readonly ultimoSeq: unknown;
  readonly pendientes: unknown;
}

/**
 * Caracteres que no se ven o cambian cómo se pinta el texto de alrededor: todos los que Unicode marca como ignorables por
 * defecto (`Default_Ignorable_Code_Point`: guion blando, espacio de ancho cero, marcas de dirección, embebidos y anulaciones
 * de dirección, unión de palabras, operadores invisibles, BOM, rellenos de Hangul, separador mongol, selectores de variación,
 * etiquetas…, incluidos los que se agreguen en versiones futuras) más los separadores de línea y de párrafo U+2028 y U+2029 (que
 * contradicen "de una sola línea") y el braille en blanco U+2800. Se exceptúa lo que un nombre legítimo necesita: la unión
 * U+200D y la no-unión U+200C (emojis de familia, escrituras como la persa), los selectores de presentación U+FE0E y U+FE0F
 * (el corazón rojo `❤️`), los selectores ideográficos U+E0100 a U+E01EF (nombres japoneses) y las etiquetas U+E0020 a U+E007F
 * (las banderas de Inglaterra, Escocia y Gales). Los espacios, el BOM y los separadores de línea y de párrafo del borde ya los
 * recortó `trim`: solo se rechazan en el medio del nombre. Un nombre hecho solo de invisibles o de lo exceptuado no se ve y se
 * rechaza. El nombre del dispositivo es deliberadamente más estricto que el apodo, que usa la regla base compartida con el cliente.
 */
const INVISIBLES = /[\u2028\u2029\u2800]|(?![\u200c\u200d\ufe0e\ufe0f\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}])\p{Default_Ignorable_Code_Point}/u;
/** Todo lo que no cuenta como algo visible: espacios e ignorables por defecto (también lo exceptuado; el resto de lo invisible ya lo rechaza INVISIBLES). */
const NO_VISIBLE = /[\s\p{Default_Ignorable_Code_Point}]/gu;

/** El nombre del dispositivo sin espacios de alrededor, con la regla del apodo (largo, controles, unidades sueltas), sin invisibles y con algo visible. */
function nombreDeDispositivo(valor: unknown): string {
  const falla = (motivo: string): never => {
    throw new ErrorDeServicio("formato_invalido", `nombreDispositivo: ${motivo}`);
  };
  const nombre = typeof valor === "string" ? valor.trim() : valor;
  const motivo = validarTextoDeUnaLinea(nombre, MAX_LARGO_DEL_NOMBRE_DE_DISPOSITIVO);
  if (motivo !== null) return falla(motivo);
  const texto = nombre as string;
  if (INVISIBLES.test(texto)) return falla("no admite caracteres invisibles");
  if (texto.replace(NO_VISIBLE, "") === "") return falla("no puede ser solo espacios o caracteres invisibles");
  return texto;
}

export class ServicioDeIdentidad {
  private readonly aleatorio: Aleatorio;

  constructor(private readonly dep: Dependencias) {
    this.aleatorio = dep.aleatorio ?? aleatorioDelSistema;
  }

  /**
   * Crea un viaje, a su organizador y su dispositivo. El servidor escribe las dos primeras operaciones del viaje
   * (`trip.create`, que crea la categoría "Otro" y las monedas, y `member.join`) con el dispositivo recién creado y una
   * marca de la hora del servidor (contadores 0 y 1: las marcas no se repiten). Se aplican con el motor y no con la
   * ingesta: son operaciones propias, y el cierre del viaje no tiene por qué mirarlas.
   */
  crearViaje(datos: DatosCrearViaje): Alta {
    if (typeof datos !== "object" || datos === null) throw new ErrorDeServicio("formato_invalido", "los datos del viaje deben ser un objeto");
    const ahora = this.dep.ahora();
    const nombre = nombreDeDispositivo(datos.nombreDispositivo);
    const tripId = uuidV7(ahora, this.aleatorio);
    const memberId = uuidV7(ahora, this.aleatorio);
    const deviceId = uuidV7(ahora, this.aleatorio);
    const token = generarToken(this.aleatorio);

    const payloadViaje: { [campo: string]: Json } = { nombre: datos.nombre, zona_horaria: datos.zonaHoraria, monedas: datos.monedas as unknown as Json };
    if (datos.fechaInicio !== undefined) payloadViaje.fecha_inicio = datos.fechaInicio;
    if (datos.fechaFin !== undefined) payloadViaje.fecha_fin = datos.fechaFin;
    const operaciones: Operacion[] = [
      { opId: uuidV7(ahora, this.aleatorio), tipo: "trip.create", entidadTipo: "trip", entidadId: tripId, hlc: formatearHlc({ ms: ahora, contador: 0, dispositivo: deviceId }), payload: payloadViaje as Campos },
      {
        opId: uuidV7(ahora, this.aleatorio),
        tipo: "member.join",
        entidadTipo: "member",
        entidadId: memberId,
        hlc: formatearHlc({ ms: ahora, contador: 1, dispositivo: deviceId }),
        payload: { apodo: datos.apodo, color: datos.color, emoji: datos.emoji, es_organizador: 1 },
      },
    ];
    for (const op of operaciones) {
      const v = validarOperacion(op);
      if (!v.ok) throw new ErrorDeServicio("formato_invalido", `${v.campo}: ${v.motivo}`);
    }

    return this.dep.identidad.transaccion(() => {
      const motor = new MotorOperaciones(this.dep.almacenDe(tripId));
      for (const op of operaciones) {
        const r = motor.aplicar(op);
        if (r.estado !== "accepted") throw new Error(`la operación propia ${op.tipo} no se aceptó: ${JSON.stringify(r)}`);
      }
      this.dep.identidad.crearDispositivo({ deviceId, tripId, memberId, nombre, tokenHash: huellaDeToken(token), creadoEn: ahora }, MAX_DISPOSITIVOS_ACTIVOS);
      return { tripId, deviceId, memberId, token };
    });
  }

  /**
   * Identifica al dispositivo que hace un pedido por su token. Un token que falta, está vacío, no es texto o no existe da
   * siempre el mismo error (`no_autorizado`, sin distinguir cuál); uno revocado da `dispositivo_revocado` (el celular se
   * detiene y muestra que fue revocado). Lo que el celular informa de sí mismo se anota solo si es válido y, si no, se
   * ignora: un encabezado raro no debe tumbar el pedido. Devuelve el dispositivo **como estaba antes** de anotar lo informado
   * en este pedido.
   */
  autenticar(token: unknown, visto?: Visto): Dispositivo {
    if (typeof token !== "string" || token === "" || token.length > MAX_LARGO_DEL_TOKEN) throw new ErrorDeServicio("no_autorizado", "token inválido");
    const dispositivo = this.dep.identidad.dispositivoPorToken(huellaDeToken(token));
    if (dispositivo === null) throw new ErrorDeServicio("no_autorizado", "token inválido");
    if (dispositivo.revocadoEn !== null) throw new ErrorDeServicio("dispositivo_revocado", "el dispositivo fue revocado");
    if (visto != null && Number.isSafeInteger(visto.ultimoSeq) && (visto.ultimoSeq as number) >= 0 && Number.isSafeInteger(visto.pendientes) && (visto.pendientes as number) >= 0) {
      this.dep.identidad.registrarVisto(dispositivo.deviceId, this.dep.ahora(), visto.ultimoSeq as number, visto.pendientes as number);
    }
    return dispositivo;
  }
}
