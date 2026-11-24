// Los archivos de los adjuntos en el disco: `{raiz}/{trip}/{adjunto}.{ext}` y, para la miniatura, `{adjunto}.thumb.jpg`. La ruta
// se arma SOLO con identificadores validados (UUID) y extensiones de una lista fija: nunca con texto del usuario.

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { UUID, type ArchivoAbierto, type ArchivosDeAdjuntos, type RefDeArchivo } from "../../dominio/adjuntos/archivos.js";

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

  async bytesDelViaje(tripId: string): Promise<number> {
    if (!UUID.test(tripId)) throw new RangeError("el viaje no es un UUID");
    let nombres: string[];
    try {
      nombres = await readdir(join(this.raiz, tripId));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw e;
    }
    let total = 0;
    for (const nombre of nombres) {
      if (nombre.endsWith(".tmp")) continue; // una subida en curso todavía no cuenta
      const info = await stat(join(this.raiz, tripId, nombre)).catch(() => null);
      if (info?.isFile() === true) total += info.size;
    }
    return total;
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
