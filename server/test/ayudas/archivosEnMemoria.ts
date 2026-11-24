import { Readable } from "node:stream";
import { 
  clasificarNombre, 
  type ArchivoAbierto, 
  type ArchivoGuardado, 
  type ArchivosDeAdjuntos, 
  type RefDeArchivo 
} from "../../src/dominio/adjuntos/archivos.js";

/** Archivos de adjuntos que viven en un Map: para las pruebas que no necesitan el disco. */
export class ArchivosEnMemoria implements ArchivosDeAdjuntos {
  readonly guardados = new Map<string, Uint8Array>();
  /** Cuándo se escribió cada archivo, en milisegundos. */
  readonly modificados = new Map<string, number>();
  guardadosEnTotal = 0;
  /** Los flujos que se abrieron para servir, para comprobar que se cierran. */
  readonly abiertos: Readable[] = [];
  /** Los archivos que se pidió borrar, en orden. */
  readonly borrados: string[] = [];
  /** Nombres (`viaje/nombre`) cuyo borrado debe fallar, para probar que un error no frena el barrido. */
  readonly fallanAlBorrar = new Set<string>();

  constructor(private readonly ahora: () => number = Date.now) {}

  private clave(ref: RefDeArchivo): string {
    return `${ref.tripId}/${ref.adjuntoId}.${ref.variante === "miniatura" ? "thumb." : ""}${ref.extension}`;
  }

  /** Pone un archivo con un nombre cualquiera (un temporal, algo desconocido) y la hora de modificación que se pida. */
  poner(tripId: string, nombre: string, bytes: number, modificadoEn: number = this.ahora()): void {
    this.guardados.set(`${tripId}/${nombre}`, new Uint8Array(bytes));
    this.modificados.set(`${tripId}/${nombre}`, modificadoEn);
  }

  /** Le pone a todo lo guardado una hora de modificación de hace `ms`. */
  envejecer(ms: number): void {
    for (const clave of this.guardados.keys()) this.modificados.set(clave, this.ahora() - ms);
  }

  async existe(ref: RefDeArchivo): Promise<boolean> {
    return this.guardados.has(this.clave(ref));
  }

  async guardar(ref: RefDeArchivo, bytes: Uint8Array): Promise<void> {
    this.guardadosEnTotal += 1;
    this.guardados.set(this.clave(ref), Uint8Array.from(bytes));
    this.modificados.set(this.clave(ref), this.ahora());
  }

  async listarViajes(): Promise<string[]> {
    return [...new Set([...this.guardados.keys()].map(
      (clave) => clave.slice(0, clave.indexOf("/"))
    ))];
  }

  async listar(tripId: string): Promise<ArchivoGuardado[]> {
    const archivos: ArchivoGuardado[] = [];
    for (const [clave, bytes] of this.guardados) {
      if (!clave.startsWith(`${tripId}/`)) continue;
      const nombre = clave.slice(tripId.length + 1);
      const { tipo, adjuntoId } = clasificarNombre(nombre);
      archivos.push({ 
        tripId, 
        nombre, 
        tipo, 
        adjuntoId, 
        bytes: bytes.length, 
        modificadoEn: this.modificados.get(clave) ?? this.ahora() 
      });
    }
    return archivos;
  }

  async borrar(archivo: ArchivoGuardado): Promise<void> {
    const clave = `${archivo.tripId}/${archivo.nombre}`;
    if (this.fallanAlBorrar.has(clave)) throw new Error("no se pudo borrar");
    this.borrados.push(clave);
    this.guardados.delete(clave);
    this.modificados.delete(clave);
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
