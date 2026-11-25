// Los archivos de los adjuntos en el disco: `{raiz}/{trip}/{adjunto}.{ext}` y, para la miniatura, `{adjunto}.thumb.jpg`. La ruta
// se arma SOLO con identificadores validados (UUID) y extensiones de una lista fija: nunca con texto del usuario.

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { 
  clasificarNombre, 
  UUID, 
  type ArchivoAbierto, 
  type ArchivoGuardado, 
  type ArchivosDeAdjuntos, 
  type RefDeArchivo 
} from "../../dominio/adjuntos/archivos.js";

const EXTENSIONES = new Set(["jpg", "png", "webp", "pdf"]);

export class ArchivosEnDisco implements ArchivosDeAdjuntos {
  constructor(private readonly raiz: string) {}

  /** La carpeta del viaje y el nombre del archivo; lanza `RangeError` si algo no es un UUID o una extensión permitida. */
  private lugar(ref: RefDeArchivo): { carpeta: string; archivo: string } {
    if (!UUID.test(ref.tripId)) throw new RangeError("el viaje no es un UUID");
    if (!UUID.test(ref.adjuntoId)) throw new RangeError("el adjunto no es un UUID");
    if (!EXTENSIONES.has(ref.extension)) throw new RangeError("la extensión no está permitida");
    if (ref.variante === "miniatura" && ref.extension !== "jpg") throw new RangeError("la miniatura es siempre jpg");
    const carpeta = join(this.raiz, ref.tripId);
    return { carpeta, archivo: join(carpeta, ref.variante === "miniatura" ? `${ref.adjuntoId}.thumb.jpg` : `${ref.adjuntoId}.${ref.extension}`) };
  }

  async existe(ref: RefDeArchivo): Promise<boolean> {
    try {
      return (await stat(this.lugar(ref).archivo)).isFile();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }

  async guardar(ref: RefDeArchivo, bytes: Uint8Array): Promise<void> {
    const { carpeta, archivo } = this.lugar(ref);
    await mkdir(carpeta, { recursive: true, mode: 0o700 });
    // se escribe completo en un temporal de la MISMA carpeta y se renombra: nadie lee un archivo a medias
    const temporal = join(carpeta, `${randomBytes(8).toString("hex")}.tmp`);
    try {
      const f = await open(temporal, "wx", 0o600);
      try {
        await f.writeFile(bytes);
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(temporal, archivo);
    } catch (e) {
      await unlink(temporal).catch(() => undefined);
      throw e;
    }
  }

  async listarViajes(): Promise<string[]> {
    try {
      const entradas = await readdir(this.raiz, { withFileTypes: true });
      return entradas.filter((e) => e.isDirectory() && UUID.test(e.name)).map((e) => e.name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  async listar(tripId: string): Promise<ArchivoGuardado[]> {
    if (!UUID.test(tripId)) throw new RangeError("el viaje no es un UUID");
    let nombres: string[];
    try {
      nombres = await readdir(join(this.raiz, tripId));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    // un archivo que desaparece mientras se lista (otra subida o el propio barrido) simplemente no aparece
    const encontrados = await Promise.all(
      nombres.map(async (nombre): Promise<ArchivoGuardado | null> => {
        const info = await stat(join(this.raiz, tripId, nombre)).catch(() => null);
        if (info === null || !info.isFile()) return null;
        const { tipo, adjuntoId } = clasificarNombre(nombre);
        return { 
          tripId, 
          nombre, 
          tipo, 
          adjuntoId, 
          bytes: info.size, 
          modificadoEn: info.mtimeMs 
        };
      }),
    );
    return encontrados.filter((archivo): archivo is ArchivoGuardado => archivo !== null);
  }

  async borrar(archivo: ArchivoGuardado): Promise<void> {
    if (!UUID.test(archivo.tripId)) throw new RangeError("el viaje no es un UUID");
    // el nombre se vuelve a clasificar acá: solo se borra lo que el servidor arma, venga lo que venga en `archivo`
    if (clasificarNombre(archivo.nombre).tipo === "desconocido") throw new RangeError("el nombre no es de un archivo del servidor");
    await unlink(join(this.raiz, archivo.tripId, archivo.nombre)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }

  async bytesDelViaje(tripId: string): Promise<number> {
    if (!UUID.test(tripId)) throw new RangeError("el viaje no es un UUID");
    let nombres: string[];
    try {
      nombres = await readdir(join(this.raiz, tripId));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw e;
    }
    // una subida en curso (.tmp) todavía no cuenta
    const tamanos = await Promise.all(
      nombres
        .filter((nombre) => !nombre.endsWith(".tmp"))
        .map(async (nombre) => {
          const info = await stat(join(this.raiz, tripId, nombre)).catch(() => null);
          return info?.isFile() === true 
            ? info.size 
            : 0;
        }),
    );
    return tamanos.reduce((suma, bytes) => suma + bytes, 0);
  }

  async abrir(ref: RefDeArchivo): Promise<ArchivoAbierto | null> {
    const { archivo } = this.lugar(ref);
    try {
      const info = await stat(archivo);
      if (!info.isFile()) return null;
      return { flujo: createReadStream(archivo), bytes: info.size };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
}
