import { statfsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArchivosEnDisco } from "../../src/almacen/archivos/archivosEnDisco.js";
import { ALERTA_DE_DISCO_BYTES, medirAlmacenamiento } from "../../src/observabilidad/almacenamiento.js";

const carpetas: string[] = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });
const temporal = () => {
  const dir = mkdtempSync(join(tmpdir(), "almacenamiento-"));
  carpetas.push(dir);
  return dir;
};
const TRIP = "018f3a6e-0000-7000-8000-000000000001";
const TRIP2 = "018f3a6e-0000-7000-8000-000000000002";

describe("medirAlmacenamiento", () => {
  it("la alerta de disco es de 1 GiB", () => {
    expect(ALERTA_DE_DISCO_BYTES).toBe(1024 * 1024 * 1024);
  });

  it("suma la base con sus archivos -wal y -shm, los adjuntos de todos los viajes y da el espacio libre del disco", async () => {
    const datos = temporal();
    const adjuntos = temporal();
    const base = join(datos, "cuaderno.db");
    writeFileSync(base, Buffer.alloc(4096));
    writeFileSync(`${base}-wal`, Buffer.alloc(1000));
    writeFileSync(`${base}-shm`, Buffer.alloc(24));
    const disco = new ArchivosEnDisco(adjuntos);
    await disco.guardar({ tripId: TRIP, adjuntoId: "aaaaaaaa-0000-4000-8000-000000000001", variante: "archivo", extension: "jpg" }, Buffer.alloc(300));
    await disco.guardar({ tripId: TRIP2, adjuntoId: "aaaaaaaa-0000-4000-8000-000000000002", variante: "archivo", extension: "pdf" }, Buffer.alloc(700));
    const m = await medirAlmacenamiento({ archivoBase: base, dirDatos: datos }, disco);
    expect([m.baseBytes, m.adjuntosBytes]).toEqual([5120, 1000]);
    const s = statfsSync(datos);
    expect(m.libreBytes).toBeGreaterThan(0);
    expect(Math.abs(m.libreBytes - s.bavail * s.bsize)).toBeLessThan(64 * 1024 * 1024);
  });

  it("si la carpeta de adjuntos no existe, la medición falla (no se ignora un disco)", async () => {
    const datos = temporal();
    const adjuntos = temporal();
    await expect(medirAlmacenamiento({ archivoBase: join(datos, "cuaderno.db"), dirDatos: datos, dirAdjuntos: join(adjuntos, "no-existe") }, new ArchivosEnDisco(adjuntos))).rejects.toThrow();
  });

  it("con dos discos distintos cuenta el que tenga menos lugar, sea el de datos o el de adjuntos", async () => {
    const datos = temporal();
    const adjuntos = temporal();
    const disco = (libres: Record<string, number>) => async (dir: string) => ({ bavail: libres[dir] ?? 0, bsize: 4096 });
    const rutas = { archivoBase: join(datos, "cuaderno.db"), dirDatos: datos, dirAdjuntos: adjuntos };
    const archivos = new ArchivosEnDisco(adjuntos);
    expect((await medirAlmacenamiento(rutas, archivos, disco({ [datos]: 1000, [adjuntos]: 10 }))).libreBytes).toBe(10 * 4096);
    expect((await medirAlmacenamiento(rutas, archivos, disco({ [datos]: 5, [adjuntos]: 10 }))).libreBytes).toBe(5 * 4096);
  });

  it("sin -wal ni -shm, sin adjuntos y sin base cuenta cero", async () => {
    const datos = temporal();
    const m = await medirAlmacenamiento({ archivoBase: join(datos, "cuaderno.db"), dirDatos: datos }, new ArchivosEnDisco(temporal()));
    expect([m.baseBytes, m.adjuntosBytes]).toEqual([0, 0]);
  });

  it("un error que no es 'no existe' se propaga (por ejemplo, la carpeta de datos no existe para medir el disco)", async () => {
    const datos = temporal();
    await expect(medirAlmacenamiento({ archivoBase: join(datos, "cuaderno.db"), dirDatos: join(datos, "no-existe") }, new ArchivosEnDisco(temporal()))).rejects.toThrow();
  });
});
