import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArchivosEnDisco } from "../../../src/almacen/archivos/archivosEnDisco.js";
import type { RefDeArchivo } from "../../../src/dominio/adjuntos/archivos.js";

const TRIP = "018f3a6e-0000-7000-8000-000000000001";
const TRIP2 = "018f3a6e-0000-7000-8000-000000000002";
const ADJ = "aaaaaaaa-0000-4000-8000-000000000001";
const carpetas: string[] = [];
afterEach(() => { for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true }); });

function raiz() {
  const dir = mkdtempSync(join(tmpdir(), "adjuntos-"));
  carpetas.push(dir);
  return { dir, disco: new ArchivosEnDisco(dir) };
}
const ref = (extra: Partial<RefDeArchivo> = {}): RefDeArchivo => ({ tripId: TRIP, adjuntoId: ADJ, variante: "archivo", extension: "jpg", ...extra });
const leer = async (flujo: AsyncIterable<unknown>): Promise<Buffer> => {
  const trozos: Buffer[] = [];
  for await (const t of flujo) trozos.push(t as Buffer);
  return Buffer.concat(trozos);
};

describe("ArchivosEnDisco", () => {
  it("guarda en {raiz}/{viaje}/{adjunto}.{ext} y la miniatura en {adjunto}.thumb.jpg, y se lee lo mismo que se guardó", async () => {
    const { dir, disco } = raiz();
    const contenido = Buffer.from("contenido del archivo");
    await disco.guardar(ref({ extension: "pdf" }), contenido);
    await disco.guardar(ref({ variante: "miniatura" }), Buffer.from("mini"));
    expect(readdirSync(join(dir, TRIP)).sort()).toEqual([`${ADJ}.pdf`, `${ADJ}.thumb.jpg`]);
    const abierto = await disco.abrir(ref({ extension: "pdf" }));
    expect(abierto?.bytes).toBe(contenido.length);
    expect((await leer(abierto!.flujo)).equals(contenido)).toBe(true);
    expect((await leer((await disco.abrir(ref({ variante: "miniatura" })))!.flujo)).toString()).toBe("mini");
  });

  it("no deja archivos temporales y crea las carpetas con permisos privados", async () => {
    const { dir, disco } = raiz();
    await disco.guardar(ref(), Buffer.from("x"));
    expect(readdirSync(join(dir, TRIP)).some((n) => n.endsWith(".tmp"))).toBe(false);
    expect(statSync(join(dir, TRIP)).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, TRIP, `${ADJ}.jpg`)).mode & 0o777).toBe(0o600);
  });

  it("existe y abrir distinguen lo que se subió de lo que no", async () => {
    const { disco } = raiz();
    expect(await disco.existe(ref())).toBe(false);
    expect(await disco.abrir(ref())).toBeNull();
    await disco.guardar(ref(), Buffer.from("x"));
    expect(await disco.existe(ref())).toBe(true);
    expect(await disco.existe(ref({ extension: "png" }))).toBe(false);
    expect(await disco.existe(ref({ variante: "miniatura" }))).toBe(false);
    expect(await disco.existe(ref({ tripId: TRIP2 }))).toBe(false);
  });

  it("un directorio en lugar del archivo no cuenta como archivo", async () => {
    const { dir, disco } = raiz();
    mkdirSync(join(dir, TRIP, `${ADJ}.jpg`), { recursive: true });
    expect(await disco.existe(ref())).toBe(false);
    expect(await disco.abrir(ref())).toBeNull();
  });

  it("los viajes no se mezclan", async () => {
    const { disco } = raiz();
    await disco.guardar(ref(), Buffer.from("del viaje 1"));
    await disco.guardar(ref({ tripId: TRIP2 }), Buffer.from("del viaje 2"));
    expect((await leer((await disco.abrir(ref()))!.flujo)).toString()).toBe("del viaje 1");
    expect((await leer((await disco.abrir(ref({ tripId: TRIP2 })))!.flujo)).toString()).toBe("del viaje 2");
  });

  it("solo arma rutas con UUID y extensiones permitidas: lo demás es RangeError y no toca nada fuera de la raíz", async () => {
    const { dir, disco } = raiz();
    const malas: Partial<RefDeArchivo>[] = [
      { tripId: "../fuera" },
      { adjuntoId: "../../fuera" },
      { adjuntoId: `${ADJ}/../x` },
      { tripId: `${TRIP}/..` },
      { adjuntoId: "AAAAAAAA-0000-4000-8000-000000000001" },
      { tripId: "" },
      { extension: "exe" },
      { extension: "jpg/../../x" },
      { extension: "" },
      { variante: "miniatura", extension: "png" },
    ];
    for (const m of malas) {
      await expect(disco.guardar(ref(m), Buffer.from("x")), JSON.stringify(m)).rejects.toThrow(RangeError);
      await expect(disco.existe(ref(m)), JSON.stringify(m)).rejects.toThrow(RangeError);
      await expect(disco.abrir(ref(m)), JSON.stringify(m)).rejects.toThrow(RangeError);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("si no se puede completar el guardado, no queda temporal ni archivo y el error se propaga", async () => {
    const { dir, disco } = raiz();
    mkdirSync(join(dir, TRIP, `${ADJ}.jpg`), { recursive: true });
    writeFileSync(join(dir, TRIP, `${ADJ}.jpg`, "ocupado"), "x");
    await expect(disco.guardar(ref(), Buffer.from("x"))).rejects.toThrow();
    expect(readdirSync(join(dir, TRIP)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("guardar dos veces el mismo archivo lo reemplaza completo, también si se guarda a la vez", async () => {
    const { dir, disco } = raiz();
    await disco.guardar(ref(), Buffer.from("uno"));
    await disco.guardar(ref(), Buffer.from("dos"));
    expect(readFileSync(join(dir, TRIP, `${ADJ}.jpg`), "utf8")).toBe("dos");
    const versiones = Array.from({ length: 12 }, (_, i) => Buffer.alloc(50_000, i + 65));
    await Promise.all(versiones.map((v) => disco.guardar(ref(), v)));
    const final = readFileSync(join(dir, TRIP, `${ADJ}.jpg`));
    expect(versiones.some((v) => v.equals(final))).toBe(true);
    expect(readdirSync(join(dir, TRIP)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("un enlace simbólico que apunta a un archivo se lee como archivo de la carpeta (la raíz es del servidor, no del usuario)", async () => {
    const { dir, disco } = raiz();
    mkdirSync(join(dir, TRIP));
    writeFileSync(join(dir, "real"), "dato");
    symlinkSync(join(dir, "real"), join(dir, TRIP, `${ADJ}.jpg`));
    expect(await disco.existe(ref())).toBe(true);
  });

  it("guarda archivos grandes sin cambiarlos", async () => {
    const { disco } = raiz();
    const grande = Buffer.alloc(3 * 1024 * 1024, 0xab);
    await disco.guardar(ref(), grande);
    expect((await leer((await disco.abrir(ref()))!.flujo)).equals(grande)).toBe(true);
  });

  it("bytesDelViaje suma los archivos completos del viaje, sin temporales ni carpetas ni los de otros viajes", async () => {
    const { dir, disco } = raiz();
    expect(await disco.bytesDelViaje(TRIP)).toBe(0);
    await disco.guardar(ref(), Buffer.alloc(100));
    await disco.guardar(ref({ adjuntoId: "aaaaaaaa-0000-4000-8000-000000000002", extension: "pdf" }), Buffer.alloc(250));
    await disco.guardar(ref({ variante: "miniatura" }), Buffer.alloc(7));
    await disco.guardar(ref({ tripId: TRIP2 }), Buffer.alloc(5000));
    writeFileSync(join(dir, TRIP, "1234.tmp"), Buffer.alloc(900));
    mkdirSync(join(dir, TRIP, "carpeta"));
    expect(await disco.bytesDelViaje(TRIP)).toBe(357);
    expect(await disco.bytesDelViaje(TRIP2)).toBe(5000);
  });

  it("bytesDelViaje solo acepta un UUID", async () => {
    const { disco } = raiz();
    for (const malo of ["../x", "", "no-es-uuid"]) await expect(disco.bytesDelViaje(malo)).rejects.toThrow(RangeError);
  });
});
