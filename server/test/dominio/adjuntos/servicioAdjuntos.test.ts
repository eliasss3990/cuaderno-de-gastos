import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { ErrorDeAdjunto, MAX_BYTES_MINIATURA, MAX_BYTES_POR_VIAJE, ServicioDeAdjuntos } from "../../../src/dominio/adjuntos/servicioAdjuntos.js";
import { MAX_BYTES_IMAGEN, MAX_BYTES_PDF } from "../../../src/dominio/operaciones/validacion.js";
import { MAX_LADO_MINIATURA_PX, MAX_LADO_PX } from "../../../src/dominio/adjuntos/formatos.js";
import { jpeg, pdf, png, sha256, webp, type Mime } from "../../ayudas/adjuntos.js";
import { ArchivosEnMemoria } from "../../ayudas/archivosEnMemoria.js";

const TRIP = "018f3a6e-0000-7000-8000-000000000001";
const ADJ = "aaaaaaaa-0000-4000-8000-000000000001";
let marcas = 0;
const marca = (): string => `${(1000 + marcas++).toString(16).padStart(13, "0")}-0000-018f3a6e-0000-7000-8000-00000000000a`;

interface Declarado { mime: Mime; bytes: number; sha256: string; tiene_miniatura: 0 | 1; quitado?: 1 }

function armar(declarado: Declarado | null, id = ADJ, maxBytesPorViaje?: number) {
  const almacen = new AlmacenMemoria();
  if (declarado !== null) {
    almacen.crearEntidad("attachment", id);
    for (const [campo, valor] of Object.entries(declarado)) almacen.escribirCampo("attachment", id, campo, valor, marca());
  }
  const archivos = new ArchivosEnMemoria();
  return { almacen, archivos, servicio: new ServicioDeAdjuntos({ almacenDe: () => almacen, archivos, ...(maxBytesPorViaje === undefined ? {} : { maxBytesPorViaje }) }) };
}
const de = (b: Buffer, mime: Mime, tiene_miniatura: 0 | 1 = 0): Declarado => ({ mime, bytes: b.length, sha256: sha256(b), tiene_miniatura });
const falla = async (p: Promise<unknown>): Promise<ErrorDeAdjunto> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorDeAdjunto);
    return e as ErrorDeAdjunto;
  }
  throw new Error("debía fallar");
};

describe("subir el archivo", () => {
  it("guarda un archivo de cada tipo permitido que cumple lo declarado", async () => {
    for (const [b, mime, ext] of [[jpeg(), "image/jpeg", "jpg"], [png(), "image/png", "png"], [webp(), "image/webp", "webp"], [pdf(), "application/pdf", "pdf"]] as const) {
      const { servicio, archivos } = armar(de(b, mime));
      expect(await servicio.subir(TRIP, ADJ, "archivo", b)).toEqual({ guardado: true, bytes: b.length });
      expect([...archivos.guardados.keys()]).toEqual([`${TRIP}/${ADJ}.${ext}`]);
      expect(Buffer.from(archivos.guardados.get(`${TRIP}/${ADJ}.${ext}`)!).equals(b)).toBe(true);
    }
  });

  it("un adjunto que no está registrado es adjunto_no_registrado y no se guarda nada", async () => {
    const { servicio, archivos } = armar(null);
    expect((await falla(servicio.subir(TRIP, ADJ, "archivo", jpeg()))).codigo).toBe("adjunto_no_registrado");
    expect(archivos.guardadosEnTotal).toBe(0);
  });

  it("uno quitado, uno eliminado para siempre o con un id que no es UUID tampoco acepta archivo", async () => {
    const b = jpeg();
    const quitado = armar({ ...de(b, "image/jpeg"), quitado: 1 });
    expect((await falla(quitado.servicio.subir(TRIP, ADJ, "archivo", b))).codigo).toBe("adjunto_no_registrado");
    const eliminado = armar(de(b, "image/jpeg"));
    eliminado.almacen.terminar("attachment", ADJ);
    expect((await falla(eliminado.servicio.subir(TRIP, ADJ, "archivo", b))).codigo).toBe("adjunto_no_registrado");
    const { servicio } = armar(de(b, "image/jpeg"));
    expect((await falla(servicio.subir(TRIP, "../x", "archivo", b))).codigo).toBe("adjunto_no_registrado");
    expect((await falla(servicio.subir("no-es-uuid", ADJ, "archivo", b))).codigo).toBe("adjunto_no_registrado");
  });

  it("un adjunto con datos declarados inservibles se trata como no registrado", async () => {
    const b = jpeg();
    for (const roto of [{ mime: "text/html", bytes: b.length, sha256: sha256(b) }, { mime: "image/jpeg", bytes: "x", sha256: sha256(b) }, { mime: "image/jpeg", bytes: b.length, sha256: 5 }]) {
      const almacen = new AlmacenMemoria();
      almacen.crearEntidad("attachment", ADJ);
      for (const [campo, valor] of Object.entries(roto)) almacen.escribirCampo("attachment", ADJ, campo, valor as never, marca());
      const servicio = new ServicioDeAdjuntos({ almacenDe: () => almacen, archivos: new ArchivosEnMemoria() });
      expect((await falla(servicio.subir(TRIP, ADJ, "archivo", b))).codigo).toBe("adjunto_no_registrado");
    }
  });

  it("los primeros bytes mandan: lo que no es de la lista blanca o no es del tipo declarado es tipo_no_permitido", async () => {
    const b = jpeg();
    const { servicio, archivos } = armar(de(b, "image/jpeg"));
    for (const malo of [Buffer.from("GIF89a" + "x".repeat(100)), png(b.length), pdf(b.length), Buffer.alloc(0), Buffer.from("<script>alert(1)</script>")]) {
      expect((await falla(servicio.subir(TRIP, ADJ, "archivo", malo))).codigo).toBe("tipo_no_permitido");
    }
    expect(archivos.guardadosEnTotal).toBe(0);
  });

  it("el tamaño tiene que ser el declarado y la huella también", async () => {
    const b = jpeg();
    const { servicio, archivos } = armar(de(b, "image/jpeg"));
    expect((await falla(servicio.subir(TRIP, ADJ, "archivo", jpeg(b.length + 1)))).codigo).toBe("formato_invalido");
    expect((await falla(servicio.subir(TRIP, ADJ, "archivo", jpeg(b.length - 1)))).codigo).toBe("formato_invalido");
    const otro = Buffer.from(b);
    otro[50] = 99;
    expect((await falla(servicio.subir(TRIP, ADJ, "archivo", otro))).codigo).toBe("hash_no_coincide");
    expect(archivos.guardadosEnTotal).toBe(0);
  });

  it("más de 5 MB una imagen o de 10 MB un PDF es adjunto_demasiado_grande, aunque lo declarado coincida", async () => {
    for (const [b, mime] of [[jpeg(MAX_BYTES_IMAGEN + 1), "image/jpeg"], [pdf(MAX_BYTES_PDF + 1), "application/pdf"]] as const) {
      const { servicio, archivos } = armar(de(b, mime));
      expect((await falla(servicio.subir(TRIP, ADJ, "archivo", b))).codigo).toBe("adjunto_demasiado_grande");
      expect(archivos.guardadosEnTotal).toBe(0);
    }
  });

  it("justo en el tope se acepta: 5 MB una imagen y 10 MB un PDF", async () => {
    for (const [b, mime] of [[jpeg(MAX_BYTES_IMAGEN), "image/jpeg"], [pdf(MAX_BYTES_PDF), "application/pdf"]] as const) {
      const { servicio } = armar(de(b, mime));
      expect((await servicio.subir(TRIP, ADJ, "archivo", b)).guardado).toBe(true);
    }
  });

  it("repetir la subida no escribe de nuevo", async () => {
    const b = jpeg();
    const { servicio, archivos } = armar(de(b, "image/jpeg"));
    expect((await servicio.subir(TRIP, ADJ, "archivo", b)).guardado).toBe(true);
    expect(await servicio.subir(TRIP, ADJ, "archivo", b)).toEqual({ guardado: false, bytes: b.length });
    expect(archivos.guardadosEnTotal).toBe(1);
  });
});

describe("subir la miniatura", () => {
  it("el tope de una miniatura es de 256 KB", () => {
    expect(MAX_BYTES_MINIATURA).toBe(256 * 1024);
  });

  it("guarda una miniatura JPEG de un adjunto que la declaró, con la extensión fija thumb.jpg", async () => {
    const b = png();
    const { servicio, archivos } = armar(de(b, "image/png", 1));
    const m = jpeg(300);
    expect(await servicio.subir(TRIP, ADJ, "miniatura", m)).toEqual({ guardado: true, bytes: 300 });
    expect([...archivos.guardados.keys()]).toEqual([`${TRIP}/${ADJ}.thumb.jpg`]);
  });

  it("sin miniatura declarada es formato_invalido", async () => {
    const { servicio } = armar(de(jpeg(), "image/jpeg", 0));
    expect((await falla(servicio.subir(TRIP, ADJ, "miniatura", jpeg(50)))).codigo).toBe("formato_invalido");
  });

  it("tiene que ser JPEG (no PNG, PDF ni cualquier cosa) y no pasar de 256 KB", async () => {
    const { servicio, archivos } = armar(de(png(), "image/png", 1));
    for (const malo of [png(50), pdf(50), Buffer.from("hola")]) expect((await falla(servicio.subir(TRIP, ADJ, "miniatura", malo))).codigo).toBe("tipo_no_permitido");
    expect((await falla(servicio.subir(TRIP, ADJ, "miniatura", jpeg(MAX_BYTES_MINIATURA + 1)))).codigo).toBe("adjunto_demasiado_grande");
    expect((await servicio.subir(TRIP, ADJ, "miniatura", jpeg(MAX_BYTES_MINIATURA))).guardado).toBe(true);
    expect(archivos.guardadosEnTotal).toBe(1);
  });

  it("la miniatura también exige que el adjunto esté registrado y repetirla no la pisa", async () => {
    expect((await falla(armar(null).servicio.subir(TRIP, ADJ, "miniatura", jpeg(50)))).codigo).toBe("adjunto_no_registrado");
    const { servicio, archivos } = armar(de(png(), "image/png", 1));
    await servicio.subir(TRIP, ADJ, "miniatura", jpeg(50));
    expect((await servicio.subir(TRIP, ADJ, "miniatura", jpeg(60))).guardado).toBe(false);
    expect([...archivos.guardados.values()].map((x) => x.length)).toEqual([50]);
  });

  it("el archivo y la miniatura se guardan por separado", async () => {
    const b = png();
    const { servicio, archivos } = armar(de(b, "image/png", 1));
    await servicio.subir(TRIP, ADJ, "miniatura", jpeg(50));
    expect((await servicio.subir(TRIP, ADJ, "archivo", b)).guardado).toBe(true);
    expect([...archivos.guardados.keys()].sort()).toEqual([`${TRIP}/${ADJ}.png`, `${TRIP}/${ADJ}.thumb.jpg`]);
  });
});

describe("bajar", () => {
  it("devuelve el archivo con el tipo declarado y una etiqueta fija por contenido", async () => {
    const b = pdf(200);
    const { servicio } = armar(de(b, "application/pdf"));
    await servicio.subir(TRIP, ADJ, "archivo", b);
    const a = await servicio.bajar(TRIP, ADJ, "archivo");
    expect([a.mime, a.bytes, a.etag]).toEqual(["application/pdf", 200, `"${sha256(b)}"`]);
    const trozos: Buffer[] = [];
    for await (const t of a.flujo) trozos.push(t as Buffer);
    expect(Buffer.concat(trozos).equals(b)).toBe(true);
  });

  it("la miniatura sale siempre como JPEG y con otra etiqueta que el archivo", async () => {
    const b = png();
    const { servicio } = armar(de(b, "image/png", 1));
    await servicio.subir(TRIP, ADJ, "archivo", b);
    await servicio.subir(TRIP, ADJ, "miniatura", jpeg(64));
    const m = await servicio.bajar(TRIP, ADJ, "miniatura");
    expect([m.mime, m.bytes, m.etag]).toEqual(["image/jpeg", 64, `"${sha256(b)}-miniatura"`]);
    expect((await servicio.bajar(TRIP, ADJ, "archivo")).etag).not.toBe(m.etag);
  });

  it("un adjunto que no existe, o una miniatura que no declaró, es no_existe", async () => {
    expect((await falla(armar(null).servicio.bajar(TRIP, ADJ, "archivo"))).codigo).toBe("no_existe");
    const { servicio } = armar(de(jpeg(), "image/jpeg", 0));
    expect((await falla(servicio.bajar(TRIP, ADJ, "miniatura"))).codigo).toBe("no_existe");
    expect((await falla(servicio.bajar(TRIP, "../x", "archivo"))).codigo).toBe("no_existe");
  });

  it("registrado pero todavía sin archivo es no_subido", async () => {
    const { servicio } = armar(de(jpeg(), "image/jpeg", 1));
    expect((await falla(servicio.bajar(TRIP, ADJ, "archivo"))).codigo).toBe("no_subido");
    expect((await falla(servicio.bajar(TRIP, ADJ, "miniatura"))).codigo).toBe("no_subido");
  });

  it("uno eliminado para siempre ya no existe aunque el archivo siga en el disco", async () => {
    const b = jpeg();
    const { servicio, almacen } = armar(de(b, "image/jpeg"));
    await servicio.subir(TRIP, ADJ, "archivo", b);
    almacen.terminar("attachment", ADJ);
    expect((await falla(servicio.bajar(TRIP, ADJ, "archivo"))).codigo).toBe("no_existe");
  });

  it("uno quitado sigue pudiéndose bajar (quitar es de la pantalla; borrar es otra cosa)", async () => {
    const b = jpeg();
    const { servicio, almacen } = armar(de(b, "image/jpeg"));
    await servicio.subir(TRIP, ADJ, "archivo", b);
    almacen.escribirCampo("attachment", ADJ, "quitado", 1, marca());
    expect((await servicio.bajar(TRIP, ADJ, "archivo")).bytes).toBe(b.length);
  });
});

describe("estructura del archivo", () => {
  it("un archivo con la firma y la huella correctas pero roto es tipo_no_permitido y no se guarda", async () => {
    const rotos: [Buffer, Mime][] = [
      [jpeg(200).subarray(0, 198), "image/jpeg"],
      [png(200).subarray(0, 190), "image/png"],
      [webp(200).subarray(0, 190), "image/webp"],
      [pdf(200).subarray(0, 100), "application/pdf"],
    ];
    for (const [b, mime] of rotos) {
      const { servicio, archivos } = armar(de(b, mime));
      const e = await falla(servicio.subir(TRIP, ADJ, "archivo", b));
      expect([mime, e.codigo]).toEqual([mime, "tipo_no_permitido"]);
      expect(archivos.guardadosEnTotal).toBe(0);
    }
  });

  it("un PDF con contenido activo es tipo_no_permitido", async () => {
    const b = Buffer.from("%PDF-1.7\n1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n%%EOF\n");
    const { servicio, archivos } = armar(de(b, "application/pdf"));
    const e = await falla(servicio.subir(TRIP, ADJ, "archivo", b));
    expect([e.codigo, e.message]).toEqual(["tipo_no_permitido", "el PDF tiene contenido activo"]);
    expect(archivos.guardadosEnTotal).toBe(0);
  });

  it("una imagen de dimensiones enormes es adjunto_demasiado_grande aunque pese poco", async () => {
    for (const [b, mime] of [[jpeg(300, MAX_LADO_PX + 1, 10), "image/jpeg"], [png(300, 20000, 20000), "image/png"], [webp(300, 9000, 9000), "image/webp"]] as const) {
      const { servicio, archivos } = armar(de(b, mime));
      const e = await falla(servicio.subir(TRIP, ADJ, "archivo", b));
      expect([mime, e.codigo]).toEqual([mime, "adjunto_demasiado_grande"]);
      expect(archivos.guardadosEnTotal).toBe(0);
    }
  });

  it("una imagen del tamaño que sube la app (2000 × 1500) se acepta", async () => {
    for (const [b, mime] of [[jpeg(300_000, 2000, 1500), "image/jpeg"], [png(300_000, 2000, 1500), "image/png"], [webp(300_000, 2000, 1500), "image/webp"]] as const) {
      expect((await armar(de(b, mime)).servicio.subir(TRIP, ADJ, "archivo", b)).guardado).toBe(true);
    }
  });

  it("la revisión viene después de la huella: con la huella mal sigue siendo hash_no_coincide", async () => {
    const b = jpeg(200).subarray(0, 198);
    const { servicio } = armar({ mime: "image/jpeg", bytes: b.length, sha256: "0".repeat(64), tiene_miniatura: 0 });
    expect((await falla(servicio.subir(TRIP, ADJ, "archivo", b))).codigo).toBe("hash_no_coincide");
  });

  it("una miniatura rota es tipo_no_permitido y una de más de 1024 px es adjunto_demasiado_grande", async () => {
    const { servicio, archivos } = armar(de(png(), "image/png", 1));
    expect((await falla(servicio.subir(TRIP, ADJ, "miniatura", jpeg(100).subarray(0, 98)))).codigo).toBe("tipo_no_permitido");
    expect((await falla(servicio.subir(TRIP, ADJ, "miniatura", jpeg(100, MAX_LADO_MINIATURA_PX + 1, 10)))).codigo).toBe("adjunto_demasiado_grande");
    expect(archivos.guardadosEnTotal).toBe(0);
    expect((await servicio.subir(TRIP, ADJ, "miniatura", jpeg(100, 256, 256))).guardado).toBe(true);
  });
});

describe("espacio por viaje", () => {
  it("el tope por defecto es de 1 GiB", () => {
    expect(MAX_BYTES_POR_VIAJE).toBe(1024 * 1024 * 1024);
  });

  it("cuando lo guardado más lo nuevo pasa del tope, es adjunto_demasiado_grande con su mensaje, y justo en el tope se acepta", async () => {
    const a = jpeg(400);
    const b = png(600);
    const { almacen, archivos, servicio } = armar(de(a, "image/jpeg"), ADJ, 1000);
    const otro = "aaaaaaaa-0000-4000-8000-000000000002";
    almacen.crearEntidad("attachment", otro);
    for (const [campo, valor] of Object.entries(de(b, "image/png"))) almacen.escribirCampo("attachment", otro, campo, valor, marca());
    expect((await servicio.subir(TRIP, ADJ, "archivo", a)).guardado).toBe(true);
    expect((await servicio.subir(TRIP, otro, "archivo", b)).guardado).toBe(true); // 400 + 600 = 1000: justo en el tope
    const c = jpeg(401);
    const tercero = "aaaaaaaa-0000-4000-8000-000000000003";
    almacen.crearEntidad("attachment", tercero);
    for (const [campo, valor] of Object.entries(de(c, "image/jpeg"))) almacen.escribirCampo("attachment", tercero, campo, valor, marca());
    const e = await falla(servicio.subir(TRIP, tercero, "archivo", c));
    expect([e.codigo, e.message]).toEqual(["adjunto_demasiado_grande", "el viaje alcanzó su límite de espacio para adjuntos"]);
    expect(archivos.guardadosEnTotal).toBe(2);
  });

  it("repetir una subida que ya está no cuenta contra el tope", async () => {
    const a = jpeg(400);
    const { servicio, archivos } = armar(de(a, "image/jpeg"), ADJ, 500);
    await servicio.subir(TRIP, ADJ, "archivo", a);
    expect((await servicio.subir(TRIP, ADJ, "archivo", a)).guardado).toBe(false);
    expect(archivos.guardadosEnTotal).toBe(1);
  });

  it("las miniaturas cuentan, y los archivos de otro viaje no", async () => {
    const a = png(400);
    const { servicio, archivos } = armar(de(a, "image/png", 1), ADJ, 500);
    await archivos.guardar({ tripId: "018f3a6e-0000-7000-8000-0000000000ff", adjuntoId: ADJ, variante: "archivo", extension: "jpg" }, new Uint8Array(10_000));
    expect((await servicio.subir(TRIP, ADJ, "archivo", a)).guardado).toBe(true);
    expect((await falla(servicio.subir(TRIP, ADJ, "miniatura", jpeg(101)))).codigo).toBe("adjunto_demasiado_grande");
    expect((await servicio.subir(TRIP, ADJ, "miniatura", jpeg(100))).guardado).toBe(true);
  });
});
