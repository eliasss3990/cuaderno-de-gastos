// Puerto de la identidad del servidor: dispositivos autorizados, invitaciones de un solo uso e intentos de unirse.
// Los tokens y los códigos nunca llegan acá en claro: el servicio entrega siempre su huella.

export interface Dispositivo {
  readonly deviceId: string;
  readonly tripId: string;
  readonly memberId: string;
  readonly nombre: string;
  readonly creadoEn: number;
  /** null mientras el dispositivo siga activo. */
  readonly revocadoEn: number | null;
  readonly ultimoVistoEn: number | null;
  readonly ultimoSeqVisto: number;
  readonly pendientes: number;
}

export interface NuevoDispositivo {
  readonly deviceId: string;
  readonly tripId: string;
  readonly memberId: string;
  readonly nombre: string;
  readonly tokenHash: string;
  readonly creadoEn: number;
}

export interface Invitacion {
  readonly invitationId: string;
  readonly tripId: string;
  /** Integrante cuyo dispositivo reemplaza, o null si es un integrante nuevo. */
  readonly reemplazaMemberId: string | null;
  readonly creadaEn: number;
  readonly venceEn: number;
  readonly usadaEn: number | null;
  readonly usadaPorDeviceId: string | null;
}

export interface NuevaInvitacion {
  readonly invitationId: string;
  readonly tripId: string;
  readonly codigoHash: string;
  readonly reemplazaMemberId: string | null;
  readonly creadaEn: number;
  readonly venceEn: number;
}

/** El viaje ya tiene el máximo de dispositivos activos. */
export class ViajeCompletoError extends Error {
  override name = "ViajeCompletoError";
}

/**
 * Dos clases de error, a propósito. (1) Una entrada que no tiene la forma que dice su tipo es un error de programación y el
 * método lanza `RangeError` sin tocar nada: los números (horas, límites, `maxActivos`, seq, pendientes) deben ser enteros
 * seguros —seq y pendientes, además, no negativos—, los identificadores y huellas texto no vacío y `ok` un booleano (un NaN
 * se enlazaría como NULL y SQLite lo trataría en silencio). (2) Un dato bien tipado que viola una regla de la base (huella
 * que no son 64 hexadecimales en minúscula, `vence_en <= creada_en`, dos dispositivos activos del mismo integrante, un
 * identificador repetido…) lo rechaza la propia base con un `SqliteError` (`CHECK` o `UNIQUE`): las reglas de datos viven
 * en un solo lugar, el esquema, y no se repiten en TypeScript.
 */
export interface RepositorioDeIdentidad {
  /**
   * Ejecuta `fn` como una unidad: si lanza un error se deshace todo. Dentro de otra transacción forma parte de ella: si
   * la interna falla y la de afuera captura el error, **lo escrito por la interna se conserva** (no hay puntos de
   * guardado); un `try/catch` alrededor de un paso transaccional deja datos a medias.
   */
  transaccion<T>(fn: () => T): T;

  /**
   * Crea un dispositivo, o lanza `ViajeCompletoError` si el viaje ya tiene `maxActivos` activos (se cuenta y se inserta
   * en un solo paso, sin carreras). Falla también si el dispositivo o la huella del token ya existen, o si el
   * integrante ya tiene otro dispositivo activo: para reemplazarlo hay que revocar al viejo antes, en la misma
   * transacción. La huella debe ser SHA-256 en 64 hexadecimales en minúscula.
   */
  crearDispositivo(d: NuevoDispositivo, maxActivos: number): void;
  dispositivo(deviceId: string): Dispositivo | null;
  /** Busca por la huella del token; también devuelve los revocados (el servicio decide qué responder). */
  dispositivoPorToken(tokenHash: string): Dispositivo | null;
  /** Todos los del viaje (también los revocados), del más antiguo al más nuevo. */
  dispositivosDelViaje(tripId: string): Dispositivo[];
  /** Cantidad de dispositivos no revocados del viaje. */
  contarActivos(tripId: string): number;
  /**
   * Revoca un dispositivo activo y devuelve true; si ya estaba revocado o no existe devuelve false y no cambia nada. Si
   * el reloj del servidor quedó antes de la creación del dispositivo, la hora de revocación es la de creación.
   */
  revocar(deviceId: string, ahoraMs: number): boolean;
  /**
   * Anota lo que el dispositivo informó en un pedido: cuándo lo vimos, su último seq y cuántas operaciones tiene
   * pendientes (enteros no negativos). No escribe sobre un dispositivo revocado ni inexistente: devuelve si lo anotó. Lo
   * informado es solo informativo (no se acota a lo que tiene el servidor): no usarlo para decidir purgas ni retención.
   */
  registrarVisto(deviceId: string, ahoraMs: number, ultimoSeq: number, pendientes: number): boolean;

  /** Falla si la huella del código ya existe. */
  crearInvitacion(i: NuevaInvitacion): void;
  invitacionPorCodigo(codigoHash: string): Invitacion | null;
  /**
   * Marca una invitación como usada solo si no estaba usada, no venció, ya empezó (con el reloj del servidor atrasado no
   * sirve todavía) y el dispositivo ya existe, está activo, es del mismo viaje, no se creó antes que la invitación, no consumió
   * otra y, si la invitación es de reemplazo, es del integrante que reemplaza; devuelve si lo logró (un solo ganador). Por eso el dispositivo se crea **antes**, en la misma
   * transacción. No dice por qué falló: el servicio relee la invitación si lo necesita y responde siempre lo mismo.
   */
  marcarUsada(invitationId: string, ahoraMs: number, deviceId: string): boolean;

  registrarIntento(ipHash: string, ahoraMs: number, ok: boolean): void;
  /** Intentos fallidos de esa IP desde `desdeMs` (inclusive). */
  intentosFallidos(ipHash: string, desdeMs: number): number;
  /** Borra los intentos anteriores a `antesDeMs` y devuelve cuántos. */
  limpiarIntentos(antesDeMs: number): number;
}
