// Servicio de identidad del servidor: crear un viaje con su primer dispositivo, autenticar a un dispositivo por su token,
// unirse con un código de invitación, invitar y revocar. No sabe de HTTP: lanza `ErrorDeServicio` con un código que la API
// traduce a su respuesta. Todo lo que escribe va en una sola transacción del repositorio de identidad (los almacenes de los
// viajes comparten su conexión), así que cada operación queda toda o ninguna.

import { aleatorioDelSistema, generarCodigo, generarToken, huellaDeCodigo, huellaDeIp, huellaDeToken, normalizarCodigo, uuidV7, type Aleatorio } from "./credenciales.js";
import { ViajeCompletoError, type Dispositivo, type RepositorioDeIdentidad } from "./identidad.js";
import { MotorOperaciones, type Almacen, type Campos, type Json, type Operacion } from "../operaciones/operaciones.js";
import { formatearHlc } from "../base/reloj.js";
import { validarOperacion, validarTextoDeUnaLinea, VERSION_DE_FORMATO } from "../operaciones/validacion.js";

export type CodigoDeError =
  | "formato_invalido"
  | "no_autorizado"
  | "dispositivo_revocado"
  | "solo_organizador"
  | "no_existe"
  | "codigo_invalido"
  | "viaje_completo"
  | "demasiadas_invitaciones"
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
/** Una invitación vale 24 horas. */
export const VIGENCIA_DE_LA_INVITACION_MS = 24 * 60 * 60 * 1000;
/** Con 5 intentos fallidos de unirse en los últimos 15 minutos desde la misma red, el siguiente se rechaza. */
export const MAX_INTENTOS_FALLIDOS = 5;
/** Invitaciones sin usar ni vencer que un organizador puede tener a la vez en un viaje (la de rescate del administrador no cuenta). */
export const MAX_INVITACIONES_PENDIENTES = 5;
export const VENTANA_DE_INTENTOS_MS = 15 * 60 * 1000;
/** Las IP que no se pueden leer comparten un solo grupo (0.0.0.0 no puede ser la IP de un cliente real). */
const IP_ILEGIBLE = "0.0.0.0";
/** Una IP (con su zona IPv6) tiene muy pocos caracteres; más que esto no es una IP y ni se analiza. */
const MAX_LARGO_DE_LA_IP = 100;
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

/** Lo que llega al unirse con un código. Apodo, color y emoji van los tres juntos (un integrante nuevo) o ninguno (un reemplazo). */
export interface DatosUnirse {
  /** Lo que escribió la persona: se normaliza (mayúsculas, sin espacios ni guiones). */
  readonly codigo: unknown;
  /** IP de quien llama, para limitar los intentos; si no se puede leer cuenta en un grupo aparte. */
  readonly ip: unknown;
  readonly nombreDispositivo: string;
  readonly apodo?: string;
  readonly color?: string;
  readonly emoji?: string;
}

/** Una invitación recién emitida: el código se entrega una sola vez, nunca se guarda. */
export interface InvitacionEmitida {
  readonly codigo: string;
  readonly venceEn: number;
}

/** Lo que recibe quien crea un viaje o se une: el token se entrega una sola vez, nunca se guarda. */
export interface Alta {
  readonly tripId: string;
  readonly deviceId: string;
  readonly memberId: string;
  readonly token: string;
  /** Los dispositivos que esta alta revocó (al reemplazar a un integrante); vacío si no reemplazó a nadie. */
  readonly revocados?: readonly string[];
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
  /** El valor secreto con el que se calculan las huellas de los códigos y de las IP (`leerPepper`). */
  readonly pepper: Uint8Array;
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
  if (texto.replaceAll(NO_VISIBLE, "") === "") return falla("no puede ser solo espacios o caracteres invisibles");
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
      { 
        opId: uuidV7(ahora, this.aleatorio), 
        tipo: "trip.create", 
        entidadTipo: "trip", 
        entidadId: tripId, 
        hlc: formatearHlc({ ms: ahora, contador: 0, dispositivo: deviceId }), 
        payload: payloadViaje as Campos, 
        schemaVersion: VERSION_DE_FORMATO 
      },
      {
        opId: uuidV7(ahora, this.aleatorio),
        tipo: "member.join",
        entidadTipo: "member",
        entidadId: memberId,
        hlc: formatearHlc({ ms: ahora, contador: 1, dispositivo: deviceId }),
        payload: { apodo: datos.apodo, color: datos.color, emoji: datos.emoji, es_organizador: 1 },
        schemaVersion: VERSION_DE_FORMATO,
      },
    ];
    for (const op of operaciones) {
      const v = validarOperacion(op);
      if (!v.ok) throw new ErrorDeServicio("formato_invalido", `${v.campo}: ${v.motivo}`);
    }

    return this.dep.identidad.transaccion(() => {
      const motor = new MotorOperaciones(this.dep.almacenDe(tripId));
      for (const op of operaciones) {
        const r = motor.aplicar(op, { deviceId, memberId, aceptadaEn: ahora });
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

  /**
   * Une un dispositivo nuevo a un viaje con un código de invitación. Todo o nada: con una invitación de reemplazo revoca al
   * dispositivo viejo y conserva al integrante; con una de integrante nuevo escribe además su `member.join`.
   *
   * Con 5 fallos en 15 minutos desde la misma red (IPv6 por /64) el siguiente da `demasiados_intentos`. Cuenta como fallo
   * todo `codigo_invalido` (código malo, usado, vencido, o de integrante nuevo sin apodo, color ni emoji, para no delatar que
   * el código existe); `formato_invalido` y `viaje_completo` no cuentan ni consumen la invitación.
   *
   * La validez de la invitación (existe, sin usar, vigente) se comprueba antes de crear el dispositivo: con el viaje lleno, la creación fallaría primero
   * con `viaje_completo` y delataría que el código existió. Los fallos se anotan fuera de la transacción (ya deshecha), así
   * que `unirse` no debe llamarse con otra transacción abierta en la conexión.
   */
  unirse(datos: DatosUnirse): Alta {
    if (typeof datos !== "object" || datos === null) throw new ErrorDeServicio("formato_invalido", "los datos para unirse deben ser un objeto");
    const ahora = this.dep.ahora();
    const nombre = nombreDeDispositivo(datos.nombreDispositivo);
    const memberId = uuidV7(ahora, this.aleatorio);
    const deviceId = uuidV7(ahora, this.aleatorio);
    const token = generarToken(this.aleatorio);
    const miembro = this.miembroNuevo(datos, memberId, deviceId, ahora);

    const huellaDeLaRed = this.huellaDeLaRed(datos.ip);
    if (this.dep.identidad.intentosFallidos(huellaDeLaRed, ahora - VENTANA_DE_INTENTOS_MS) >= MAX_INTENTOS_FALLIDOS) {
      throw new ErrorDeServicio("demasiados_intentos", "demasiados intentos fallidos: probá de nuevo más tarde");
    }
    const codigoInvalido = () => new ErrorDeServicio("codigo_invalido", "código inválido");
    const codigo = normalizarCodigo(datos.codigo);
    try {
      if (codigo === null) throw codigoInvalido();
      return this.dep.identidad.transaccion(() => {
        const invitacion = this.dep.identidad.invitacionPorCodigo(huellaDeCodigo(codigo, this.dep.pepper));
        if (invitacion === null || invitacion.usadaEn !== null || invitacion.venceEn <= ahora || invitacion.creadaEn > ahora) throw codigoInvalido();
        const esReemplazo = invitacion.reemplazaMemberId !== null;
        if (!esReemplazo && miembro === null) throw codigoInvalido();
        const tripId = invitacion.tripId;
        const almacen = this.dep.almacenDe(tripId);
        const integrante = invitacion.reemplazaMemberId ?? memberId;
        if (esReemplazo && !almacen.entidadExiste("member", integrante)) throw new Error(`la invitación ${invitacion.invitationId} reemplaza a un integrante que no existe en el viaje`);

        const revocados: string[] = [];
        if (esReemplazo) {
          for (const d of this.dep.identidad.dispositivosDelViaje(tripId)) {
            if (d.memberId === integrante && d.revocadoEn === null) {
              this.dep.identidad.revocar(d.deviceId, ahora);
              revocados.push(d.deviceId);
            }
          }
        }
        try {
          this.dep.identidad.crearDispositivo({ deviceId, tripId, memberId: integrante, nombre, tokenHash: huellaDeToken(token), creadoEn: ahora }, MAX_DISPOSITIVOS_ACTIVOS);
        } catch (e) {
          if (e instanceof ViajeCompletoError) throw new ErrorDeServicio("viaje_completo", "el viaje ya tiene 4 dispositivos activos");
          throw e;
        }
        if (!esReemplazo && miembro !== null) {
          const r = new MotorOperaciones(almacen).aplicar(miembro, { deviceId, memberId: integrante, aceptadaEn: ahora });
          if (r.estado !== "accepted") throw new Error(`la operación propia ${miembro.tipo} no se aceptó: ${JSON.stringify(r)}`);
        }
        if (!this.dep.identidad.marcarUsada(invitacion.invitationId, ahora, deviceId)) throw codigoInvalido();
        this.dep.identidad.registrarIntento(huellaDeLaRed, ahora, true);
        return { tripId, deviceId, memberId: integrante, token, revocados };
      });
    } catch (e) {
      // la transacción ya se deshizo: el fallo se anota aparte para que cuente
      if (e instanceof ErrorDeServicio && e.codigo === "codigo_invalido") this.dep.identidad.registrarIntento(huellaDeLaRed, ahora, false);
      throw e;
    }
  }

  /**
   * Emite una invitación de un solo uso y 24 horas. Solo el organizador puede (`solo_organizador`); `actor` debe venir de
   * `autenticar` en este mismo pedido. Con `reemplazaMemberId` es una invitación de reemplazo (celular nuevo de la misma
   * persona): el integrante debe existir en el viaje (`no_existe`).
   */
  invitar(actor: Dispositivo, reemplazaMemberId?: string | null): InvitacionEmitida {
    const almacen = this.dep.almacenDe(actor.tripId);
    this.exigirOrganizador(actor, almacen);
    if (this.dep.identidad.invitacionesPendientes(actor.tripId, this.dep.ahora()) >= MAX_INVITACIONES_PENDIENTES) {
      throw new ErrorDeServicio("demasiadas_invitaciones", `ya hay ${MAX_INVITACIONES_PENDIENTES} invitaciones sin usar; esperá a que se usen o venzan`);
    }
    return this.emitirInvitacion(actor.tripId, reemplazaMemberId ?? null, almacen, false);
  }

  /**
   * Invitación de rescate (el celular del organizador se perdió) o cualquier otra, emitida por quien administra el servidor,
   * sin pasar por un dispositivo. La invitación se crea ANTES que el dispositivo que la use: un dispositivo anterior a su
   * invitación no puede consumirla.
   */
  invitarComoAdministrador(tripId: string, reemplazaMemberId: string | null): InvitacionEmitida {
    const almacen = this.dep.almacenDe(tripId);
    if (almacen.idDelViaje() === null) throw new ErrorDeServicio("no_existe", "el viaje no existe");
    return this.emitirInvitacion(tripId, reemplazaMemberId, almacen, true);
  }

  /**
   * Revoca un dispositivo del mismo viaje. Solo el organizador puede (`solo_organizador`); `actor` debe venir de `autenticar`.
   * Un dispositivo que no existe, que es de otro viaje o cuyo identificador no es texto da el mismo `no_existe`. Revocar uno
   * ya revocado no cambia nada. El organizador puede revocar su propio dispositivo (queda sin acceso: lo recupera una
   * invitación de rescate).
   */
  revocar(actor: Dispositivo, deviceId: unknown): void {
    this.exigirOrganizador(actor, this.dep.almacenDe(actor.tripId));
    const objetivo = typeof deviceId === "string" && deviceId !== "" ? this.dep.identidad.dispositivo(deviceId) : null;
    if (objetivo === null || objetivo.tripId !== actor.tripId) throw new ErrorDeServicio("no_existe", "el dispositivo no existe");
    this.dep.identidad.revocar(objetivo.deviceId, this.dep.ahora());
  }

  /**
   * La lista de dispositivos del viaje (también los revocados, del más antiguo al más nuevo) con lo que cada uno informó en su
   * último pedido, más la cabeza del viaje y la hora del servidor: con eso la app calcula "al día" y "hace X". Quien pregunta
   * ya está autenticado (un revocado no llega acá). Nunca incluye las huellas de los tokens.
   */
  familia(actor: Dispositivo): {
    readonly dispositivos: readonly Dispositivo[];
    readonly cabeza: number;
    readonly ahora: number;
  } {
    return {
      dispositivos: this.dep.identidad.dispositivosDelViaje(actor.tripId),
      cabeza: this.dep.almacenDe(actor.tripId).seqMaximo(),
      ahora: this.dep.ahora(),
    };
  }

  /** Mantenimiento periódico: borra los intentos de unirse que ya salieron de la ventana. Devuelve cuántos. */
  mantenimiento(): number {
    return this.dep.identidad.limpiarIntentos(this.dep.ahora() - VENTANA_DE_INTENTOS_MS);
  }

  private exigirOrganizador(actor: Dispositivo, almacen: Almacen): void {
    if (almacen.leerCampo("member", actor.memberId, "es_organizador") !== 1) throw new ErrorDeServicio("solo_organizador", "solo el organizador puede hacerlo");
  }

  private emitirInvitacion(tripId: string, reemplazaMemberId: string | null, almacen: Almacen, porAdministrador: boolean): InvitacionEmitida {
    if (reemplazaMemberId !== null) {
      if (typeof reemplazaMemberId !== "string" || reemplazaMemberId === "") throw new ErrorDeServicio("formato_invalido", "reemplazaMemberId: debe ser texto");
      if (!almacen.entidadExiste("member", reemplazaMemberId)) throw new ErrorDeServicio("no_existe", "el integrante no existe");
    }
    const ahora = this.dep.ahora();
    const codigo = generarCodigo(this.aleatorio);
    const venceEn = ahora + VIGENCIA_DE_LA_INVITACION_MS;
    this.dep.identidad.crearInvitacion({ invitationId: uuidV7(ahora, this.aleatorio), tripId, codigoHash: huellaDeCodigo(codigo, this.dep.pepper), reemplazaMemberId, creadaEn: ahora, venceEn, porAdministrador });
    return { codigo, venceEn };
  }

  /**
   * El `member.join` de un integrante nuevo, o null si no llegaron apodo, color ni emoji (un reemplazo). Si llegan algunos
   * pero no los tres, o alguno es inválido, es `formato_invalido`: eso no depende del código, así que no deja saber nada de él.
   */
  private miembroNuevo(datos: DatosUnirse, memberId: string, deviceId: string, ahora: number): Operacion | null {
    const llegaron = [datos.apodo, datos.color, datos.emoji].filter((c) => c !== undefined).length;
    if (llegaron === 0) return null;
    if (llegaron < 3) throw new ErrorDeServicio("formato_invalido", "apodo, color y emoji van juntos");
    const op: Operacion = {
      opId: uuidV7(ahora, this.aleatorio),
      tipo: "member.join",
      entidadTipo: "member",
      entidadId: memberId,
      hlc: formatearHlc({ ms: ahora, contador: 0, dispositivo: deviceId }),
      payload: { apodo: datos.apodo as string, color: datos.color as string, emoji: datos.emoji as string, es_organizador: 0 },
      schemaVersion: VERSION_DE_FORMATO,
    };
    const v = validarOperacion(op);
    if (!v.ok) throw new ErrorDeServicio("formato_invalido", `${v.campo}: ${v.motivo}`);
    return op;
  }

  /** La huella de la red de quien llama; una IP que no se puede leer cuenta en un grupo aparte. */
  private huellaDeLaRed(ip: unknown): string {
    try {
      if (typeof ip === "string" && ip.length > MAX_LARGO_DE_LA_IP) throw new RangeError("la IP es demasiado larga");
      return huellaDeIp(ip as string, this.dep.pepper);
    } catch (e) {
      // `claveDeRed` lanza `RangeError` si no es una IP; un pepper inválido lanzaría lo mismo desde aquí y saldría igual
      if (e instanceof RangeError) return huellaDeIp(IP_ILEGIBLE, this.dep.pepper);
      throw e;
    }
  }
}
