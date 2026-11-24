// Subir y bajar los archivos de los adjuntos de un viaje. El adjunto tiene que estar registrado (su `attachment.add` fue
// aceptado): de ahí salen el tipo, el tamaño y la huella que el archivo debe cumplir.

import { createHash } from "node:crypto";
import type { Almacen } from "../operaciones/operaciones.js";
import { MAX_BYTES_IMAGEN, MAX_BYTES_PDF } from "../operaciones/validacion.js";
import { inspeccionar, inspeccionarMiniatura, type Inspeccion } from "./formatos.js";
import { detectarTipo, EXTENSION_DE, UUID, type ArchivoAbierto, type ArchivosDeAdjuntos, type Mime, type RefDeArchivo, type Variante } from "./archivos.js";

/** Lo más que pesa una miniatura (la app genera unos 20 a 40 KB). */
export const MAX_BYTES_MINIATURA = 256 * 1024;

/** Espacio que pueden ocupar los archivos de un viaje (unas 3.000 fotos de 300 KB): un celular roto o robado no llena el disco. */
export const MAX_BYTES_POR_VIAJE = 1024 * 1024 * 1024;

export type CodigoDeErrorDeAdjunto =
  | "formato_invalido"
  | "no_existe"
  | "no_subido"
  | "adjunto_no_registrado"
  | "adjunto_demasiado_grande"
  | "tipo_no_permitido"
  | "hash_no_coincide";

export class ErrorDeAdjunto extends Error {
  constructor(
    readonly codigo: CodigoDeErrorDeAdjunto,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorDeAdjunto";
  }
}

export interface DependenciasDeAdjuntos {
  readonly almacenDe: (tripId: string) => Almacen;
  readonly archivos: ArchivosDeAdjuntos;
  /** Espacio máximo por viaje; por defecto `MAX_BYTES_POR_VIAJE`. */
  readonly maxBytesPorViaje?: number;
}

export interface AdjuntoRegistrado {
  readonly mime: Mime;
  readonly bytes: number;
  readonly sha256: string;
  readonly tieneMiniatura: boolean;
  readonly quitado: boolean;
}

export interface ArchivoParaServir extends ArchivoAbierto {
  readonly mime: Mime;
  /** Identifica el contenido: no cambia nunca para un mismo adjunto. */
  readonly etag: string;
}

export interface ResultadoDeSubida {
  /** false si ya estaba subido (un reintento): no se escribió nada. */
  readonly guardado: boolean;
  readonly bytes: number;
}

export class ServicioDeAdjuntos {
  constructor(private readonly dep: DependenciasDeAdjuntos) {}

  async subir(tripId: string, adjuntoId: string, variante: Variante, contenido: Uint8Array): Promise<ResultadoDeSubida> {
    const adjunto = this.registrado(tripId, adjuntoId);
    if (adjunto === null || adjunto.quitado) throw new ErrorDeAdjunto("adjunto_no_registrado", "el adjunto no está registrado");
    const tipo = detectarTipo(contenido);

    if (variante === "miniatura") {
      if (!adjunto.tieneMiniatura) throw new ErrorDeAdjunto("formato_invalido", "el adjunto no declaró miniatura");
      if (tipo !== "image/jpeg") throw new ErrorDeAdjunto("tipo_no_permitido", "la miniatura debe ser una imagen JPEG");
      if (contenido.length > MAX_BYTES_MINIATURA) throw new ErrorDeAdjunto("adjunto_demasiado_grande", "la miniatura es demasiado grande");
      this.exigirEstructura(inspeccionarMiniatura(contenido));
    } else {
      if (tipo === null || tipo !== adjunto.mime) throw new ErrorDeAdjunto("tipo_no_permitido", "el archivo no es del tipo declarado");
      if (contenido.length > (tipo === "application/pdf" ? MAX_BYTES_PDF : MAX_BYTES_IMAGEN)) {
        throw new ErrorDeAdjunto("adjunto_demasiado_grande", "el archivo es demasiado grande");
      }
      if (contenido.length !== adjunto.bytes) throw new ErrorDeAdjunto("formato_invalido", "el tamaño no coincide con el declarado");
      if (createHash("sha256").update(contenido).digest("hex") !== adjunto.sha256) throw new ErrorDeAdjunto("hash_no_coincide", "la huella no coincide con la declarada");
      this.exigirEstructura(inspeccionar(contenido, tipo));
    }

    // el contenido de un adjunto no cambia: si ya está, el reintento no escribe nada
    const ref = this.ref(tripId, adjuntoId, variante, adjunto.mime);
    if (await this.dep.archivos.existe(ref)) return { guardado: false, bytes: contenido.length };
    // (dos subidas a la vez pueden pasarse un poco del tope: no es una garantía exacta)
    if ((await this.dep.archivos.bytesDelViaje(tripId)) + contenido.length > (this.dep.maxBytesPorViaje ?? MAX_BYTES_POR_VIAJE)) {
      throw new ErrorDeAdjunto("adjunto_demasiado_grande", "el viaje alcanzó su límite de espacio para adjuntos");
    }
    await this.dep.archivos.guardar(ref, contenido);
    return { guardado: true, bytes: contenido.length };
  }

  async bajar(tripId: string, adjuntoId: string, variante: Variante): Promise<ArchivoParaServir> {
    const adjunto = this.registrado(tripId, adjuntoId);
    if (adjunto === null || (variante === "miniatura" && !adjunto.tieneMiniatura)) throw new ErrorDeAdjunto("no_existe", "el adjunto no existe");
    const abierto = await this.dep.archivos.abrir(this.ref(tripId, adjuntoId, variante, adjunto.mime));
    if (abierto === null) throw new ErrorDeAdjunto("no_subido", "el archivo todavía no se subió");
    return variante === "miniatura"
      ? { ...abierto, mime: "image/jpeg", etag: `"${adjunto.sha256}-miniatura"` }
      : { ...abierto, mime: adjunto.mime, etag: `"${adjunto.sha256}"` };
  }

  /** Un archivo dañado, cortado o con contenido activo es un tipo no permitido; uno de dimensiones enormes, demasiado grande. */
  private exigirEstructura(r: Inspeccion): void {
    if (r.ok) return;
    throw new ErrorDeAdjunto(r.causa === "dimensiones" ? "adjunto_demasiado_grande" : "tipo_no_permitido", r.motivo);
  }

  private ref(tripId: string, adjuntoId: string, variante: Variante, mime: Mime): RefDeArchivo {
    return { tripId, adjuntoId, variante, extension: variante === "miniatura" ? "jpg" : EXTENSION_DE[mime] };
  }

  /** Lo que declaró el `attachment.add` aceptado, o null si no hay un adjunto con ese id (o ya se eliminó para siempre). */
  private registrado(tripId: string, adjuntoId: string): AdjuntoRegistrado | null {
    if (!UUID.test(tripId) || !UUID.test(adjuntoId)) return null;
    const almacen = this.dep.almacenDe(tripId);
    if (!almacen.entidadExiste("attachment", adjuntoId)) return null;
    const mime = almacen.leerCampo("attachment", adjuntoId, "mime");
    const bytes = almacen.leerCampo("attachment", adjuntoId, "bytes");
    const sha256 = almacen.leerCampo("attachment", adjuntoId, "sha256");
    if (typeof mime !== "string" || !(mime in EXTENSION_DE) || typeof bytes !== "number" || typeof sha256 !== "string") return null;
    return {
      mime: mime as Mime,
      bytes,
      sha256,
      tieneMiniatura: almacen.leerCampo("attachment", adjuntoId, "tiene_miniatura") === 1,
      quitado: almacen.leerCampo("attachment", adjuntoId, "quitado") === 1,
    };
  }
}
