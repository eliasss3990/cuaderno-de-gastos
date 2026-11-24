import { Readable } from "node:stream";
import type { ArchivoAbierto, ArchivosDeAdjuntos, RefDeArchivo } from "../../src/dominio/adjuntos/archivos.js";

/** Archivos de adjuntos que viven en un Map: para las pruebas que no necesitan el disco. */
export class ArchivosEnMemoria implements ArchivosDeAdjuntos {
  readonly guardados = new Map<string, Uint8Array>();
  guardadosEnTotal = 0;
  /** Los flujos que se abrieron para servir, para comprobar que se cierran. */
  readonly abiertos: Readable[] = [];

  private clave(ref: RefDeArchivo): string {
    return `${ref.tripId}/${ref.adjuntoId}.${ref.variante === "miniatura" ? "thumb." : ""}${ref.extension}`;
  }

  async existe(ref: RefDeArchivo): Promise<boolean> {
    return this.guardados.has(this.clave(ref));
  }

  async guardar(ref: RefDeArchivo, bytes: Uint8Array): Promise<void> {
    this.guardadosEnTotal += 1;
    this.guardados.set(this.clave(ref), Uint8Array.from(bytes));
  }

  async bytesDelViaje(tripId: string): Promise<number> {
    let total = 0;
    for (const [clave, bytes] of this.guardados) if (clave.startsWith(`${tripId}/`)) total += bytes.length;
    return total;
  }

  async abrir(ref: RefDeArchivo): Promise<ArchivoAbierto | null> {
    const bytes = this.guardados.get(this.clave(ref));
    if (bytes === undefined) return null;
    const flujo = Readable.from([Buffer.from(bytes)]);
    this.abiertos.push(flujo);
    return { flujo, bytes: bytes.length };
  }
}
