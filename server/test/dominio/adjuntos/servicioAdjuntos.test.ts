import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../../../src/dominio/operaciones/almacenMemoria.js";
import { ErrorDeAdjunto, GRACIA_DEL_BARRIDO_MS, MAX_BYTES_MINIATURA, MAX_BYTES_POR_VIAJE, REVISION_COMPLETA_DEL_BARRIDO_MS, ServicioDeAdjuntos } from "../../../src/dominio/adjuntos/servicioAdjuntos.js";
import { MAX_BYTES_IMAGEN, MAX_BYTES_PDF } from "../../../src/dominio/operaciones/validacion.js";
import { MAX_LADO_MINIATURA_PX, MAX_LADO_PX } from "../../../src/dominio/adjuntos/formatos.js";
import { jpeg, pdf, png, sha256, webp, type Mime } from "../../ayudas/adjuntos.js";
import { ArchivosEnMemoria } from "../../ayudas/archivosEnMemoria.js";
import { SOBRE_GUARDADO } from "../../ayudas/autor.js";

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

describe("barrer: archivos que sobran", () => {
  const HORA = 2 * 3_600_000; // más viejo que la gracia
  const AHORA = 1_800_000_000_000;
  const OTRO = "aaaaaaaa-0000-4000-8000-000000000002";
  const TERCERO = "aaaaaaaa-0000-4000-8000-000000000003";
  const TEMPORAL = "0123456789abcdef.tmp";
  const CERO = { revisados: 0, huerfanosBorrados: 0, temporalesBorrados: 0, bytesLiberados: 0, sinRegistro: 0, desconocidos: 0, viajesDesconocidos: 0, viajesSinCambios: 0, errores: 0 };

  /** Un viaje conocido, con archivos guardados `HORA` atrás (más viejos que la gracia). */
  function viaje() {
    const almacen = new AlmacenMemoria();
    almacen.crearEntidad("trip", TRIP);
    const archivos = new ArchivosEnMemoria(() => AHORA);
    const servicio = new ServicioDeAdjuntos({ almacenDe: () => almacen, archivos });
    const registrar = (id: string, extra: Partial<Declarado> = {}) => {
      almacen.crearEntidad("attachment", id);
      const declarado: Declarado = { mime: "image/jpeg", bytes: 100, sha256: "a".repeat(64), tiene_miniatura: 1, ...extra };
      for (const [campo, valor] of Object.entries(declarado)) almacen.escribirCampo("attachment", id, campo, valor, marca());
    };
    /** Un adjunto que se purgó: tiene lápida. */
    const purgar = (id: string) => {
      registrar(id);
      almacen.terminar("attachment", id);
    };
    const poner = (nombre: string, bytes = 100, hace = HORA) => archivos.poner(TRIP, nombre, bytes, AHORA - hace);
    return { almacen, archivos, servicio, registrar, purgar, poner };
  }

  it("borra el archivo y la miniatura de un adjunto terminado y deja los de un adjunto vivo", async () => {
    const { archivos, servicio, registrar, purgar, poner } = viaje();
    registrar(ADJ);
    purgar(OTRO);
    for (const id of [ADJ, OTRO]) {
      poner(`${id}.jpg`, 1000);
      poner(`${id}.thumb.jpg`, 50);
    }
    const r = await servicio.barrer(AHORA);
    expect([...archivos.guardados.keys()].sort()).toEqual([`${TRIP}/${ADJ}.jpg`, `${TRIP}/${ADJ}.thumb.jpg`]);
    expect(r).toEqual({ ...CERO, revisados: 4, huerfanosBorrados: 2, bytesLiberados: 1050 });
  });

  it("un archivo de un adjunto que la base no conoce ni dio por terminado NO se borra (por ejemplo, tras restaurar un respaldo viejo), y se cuenta", async () => {
    const { archivos, servicio, poner } = viaje();
    poner(`${TERCERO}.pdf`, 700);
    poner(`${TERCERO}.thumb.jpg`, 20);
    const r = await servicio.barrer(AHORA);
    expect(archivos.guardados.size).toBe(2);
    expect(archivos.borrados).toEqual([]);
    expect(r).toEqual({ ...CERO, revisados: 2, sinRegistro: 2 });
  });

  it("un adjunto registrado, quitado o con la miniatura sin declarar conserva todos sus archivos y no cuenta como sin registro", async () => {
    const { archivos, servicio, registrar, poner } = viaje();
    registrar(ADJ, { quitado: 1 });
    registrar(OTRO, { tiene_miniatura: 0 });
    for (const id of [ADJ, OTRO]) {
      poner(`${id}.jpg`);
      poner(`${id}.thumb.jpg`);
    }
    const r = await servicio.barrer(AHORA);
    expect(archivos.guardados.size).toBe(4);
    expect([r.huerfanosBorrados, r.sinRegistro]).toEqual([0, 0]);
  });

  it("la lápida manda aunque el archivo sea de una extensión distinta de la declarada", async () => {
    const { archivos, servicio, purgar, poner } = viaje();
    purgar(ADJ);
    poner(`${ADJ}.png`);
    poner(`${ADJ}.webp`);
    poner(`${ADJ}.pdf`);
    expect((await servicio.barrer(AHORA)).huerfanosBorrados).toBe(3);
    expect(archivos.guardados.size).toBe(0);
  });

  it("no toca lo que tiene menos de la gracia, y justo en la gracia ya se borra", async () => {
    const { archivos, servicio, purgar, poner } = viaje();
    for (const id of [ADJ, OTRO, TERCERO]) purgar(id);
    poner(`${ADJ}.jpg`, 10, GRACIA_DEL_BARRIDO_MS - 1);
    poner(`${OTRO}.jpg`, 10, GRACIA_DEL_BARRIDO_MS);
    poner(`${TERCERO}.jpg`, 10, 0);
    const r = await servicio.barrer(AHORA);
    expect([...archivos.guardados.keys()].sort()).toEqual([`${TRIP}/${ADJ}.jpg`, `${TRIP}/${TERCERO}.jpg`]);
    expect(r.huerfanosBorrados).toBe(1);
  });

  it("la gracia por defecto es de 1 hora y se puede pedir otra", async () => {
    expect(GRACIA_DEL_BARRIDO_MS).toBe(60 * 60 * 1000);
    const { archivos, servicio, purgar, poner } = viaje();
    purgar(ADJ);
    poner(`${ADJ}.jpg`, 10, 5000);
    expect((await servicio.barrer(AHORA)).huerfanosBorrados).toBe(0);
    expect((await servicio.barrer(AHORA, 5000)).huerfanosBorrados).toBe(1);
    expect(archivos.guardados.size).toBe(0);
  });

  it("borra las subidas que quedaron a medias solo si son viejas", async () => {
    const { archivos, servicio, poner } = viaje();
    poner(TEMPORAL, 300);
    poner("fedcba9876543210.tmp", 20, 1000);
    const r = await servicio.barrer(AHORA);
    expect([...archivos.guardados.keys()]).toEqual([`${TRIP}/fedcba9876543210.tmp`]);
    expect([r.temporalesBorrados, r.huerfanosBorrados, r.bytesLiberados]).toEqual([1, 0, 300]);
  });

  it("no toca ni borra lo que no entiende, aunque sea viejo, y lo cuenta", async () => {
    const { archivos, servicio, poner } = viaje();
    for (const nombre of ["notas.txt", `${ADJ}.exe`, `${ADJ}.thumb.png`, "ABCDEF.tmp", `${ADJ.toUpperCase()}.jpg`]) poner(nombre);
    const r = await servicio.barrer(AHORA);
    expect(archivos.guardados.size).toBe(5);
    expect([r.desconocidos, r.huerfanosBorrados, r.temporalesBorrados, r.sinRegistro, archivos.borrados.length]).toEqual([5, 0, 0, 0, 0]);
  });

  it("un viaje que la base no conoce no se toca (ni sus temporales), y se cuenta", async () => {
    const almacen = new AlmacenMemoria();
    almacen.crearEntidad("trip", TRIP);
    almacen.crearEntidad("attachment", OTRO);
    almacen.terminar("attachment", OTRO);
    const archivos = new ArchivosEnMemoria(() => AHORA);
    const ajeno = "018f3a6e-0000-7000-8000-0000000000ff";
    const vacio = new AlmacenMemoria();
    vacio.crearEntidad("attachment", ADJ);
    vacio.terminar("attachment", ADJ);
    const servicio = new ServicioDeAdjuntos({ almacenDe: (id) => (id === TRIP ? almacen : vacio), archivos });
    archivos.poner(ajeno, `${ADJ}.jpg`, 500, AHORA - HORA);
    archivos.poner(ajeno, TEMPORAL, 500, AHORA - HORA);
    archivos.poner(TRIP, `${OTRO}.jpg`, 100, AHORA - HORA);
    const r = await servicio.barrer(AHORA);
    expect([...archivos.guardados.keys()].sort()).toEqual([`${ajeno}/${TEMPORAL}`, `${ajeno}/${ADJ}.jpg`].sort());
    expect([r.viajesDesconocidos, r.huerfanosBorrados, r.revisados]).toEqual([1, 1, 1]);
  });

  it("un error al borrar un archivo no frena a los demás y se cuenta", async () => {
    const { archivos, servicio, purgar, poner } = viaje();
    for (const id of [ADJ, OTRO, TERCERO]) {
      purgar(id);
      poner(`${id}.jpg`);
    }
    archivos.fallanAlBorrar.add(`${TRIP}/${OTRO}.jpg`);
    const r = await servicio.barrer(AHORA);
    expect([...archivos.guardados.keys()]).toEqual([`${TRIP}/${OTRO}.jpg`]);
    expect([r.huerfanosBorrados, r.errores]).toEqual([2, 1]);
  });

  it("un error de la base al decidir no borra nada y se cuenta como error (no como sin registro)", async () => {
    const { almacen, archivos, servicio, purgar, poner } = viaje();
    purgar(ADJ);
    poner(`${ADJ}.jpg`);
    almacen.entidadTerminada = () => {
      throw new Error("base ilegible");
    };
    const r = await servicio.barrer(AHORA);
    expect(archivos.guardados.size).toBe(1);
    expect([r.errores, r.huerfanosBorrados, r.sinRegistro]).toEqual([1, 0, 0]);
  });

  it("un error al listar un viaje no frena a los otros viajes", async () => {
    const almacen = new AlmacenMemoria();
    almacen.crearEntidad("trip", TRIP);
    almacen.crearEntidad("attachment", OTRO);
    almacen.terminar("attachment", OTRO);
    const archivos = new ArchivosEnMemoria(() => AHORA);
    const roto = "018f3a6e-0000-7000-8000-0000000000aa";
    const original = archivos.listar.bind(archivos);
    archivos.listar = async (tripId) => {
      if (tripId === roto) throw new Error("no se puede listar");
      return original(tripId);
    };
    const servicio = new ServicioDeAdjuntos({ almacenDe: () => almacen, archivos });
    archivos.poner(roto, `${ADJ}.jpg`, 10, AHORA - HORA);
    archivos.poner(TRIP, `${OTRO}.jpg`, 10, AHORA - HORA);
    const r = await servicio.barrer(AHORA);
    expect([r.errores, r.huerfanosBorrados]).toEqual([1, 1]);
    expect(archivos.guardados.has(`${TRIP}/${OTRO}.jpg`)).toBe(false);
  });

  it("sin nada guardado no hace nada", async () => {
    const { servicio } = viaje();
    expect(await servicio.barrer(AHORA)).toEqual(CERO);
  });

  it("después de barrer, el espacio de lo borrado vuelve a estar disponible en la cuota del viaje", async () => {
    const { archivos, servicio, purgar, poner } = viaje();
    purgar(OTRO);
    poner(`${OTRO}.jpg`, 900);
    expect(await archivos.bytesDelViaje(TRIP)).toBe(900);
    await servicio.barrer(AHORA);
    expect(await archivos.bytesDelViaje(TRIP)).toBe(0);
  });
});

describe("barrer: solo los viajes con cambios", () => {
  const HORA = 2 * 3_600_000;
  const AHORA = 1_800_000_000_000;
  const OTRO = "aaaaaaaa-0000-4000-8000-000000000002";
  const TERCERO = "aaaaaaaa-0000-4000-8000-000000000003";
  let operaciones = 0;

  /** Una operación cualquiera aceptada: sube la cabeza del viaje, como lo hace una purga de verdad. */
  const unaOperacion = (almacen: AlmacenMemoria): void => {
    operaciones += 1;
    almacen.guardarOp({ opId: `op-${operaciones}`, tipo: "expense.update", entidadTipo: "expense", entidadId: "e1", hlc: marca(), payload: {}, redactada: false, padreId: null, ...SOBRE_GUARDADO });
  };

  function entorno() {
    const almacen = new AlmacenMemoria();
    almacen.crearEntidad("trip", TRIP);
    const archivos = new ArchivosEnMemoria(() => AHORA);
    let listados = 0;
    const original = archivos.listar.bind(archivos);
    archivos.listar = async (tripId) => {
      listados += 1;
      return original(tripId);
    };
    const servicio = new ServicioDeAdjuntos({ almacenDe: () => almacen, archivos });
    const purgar = (id: string) => {
      almacen.crearEntidad("attachment", id);
      almacen.terminar("attachment", id);
    };
    return { almacen, archivos, servicio, purgar, listados: () => listados, poner: (nombre: string, hace = HORA) => archivos.poner(TRIP, nombre, 100, AHORA - hace) };
  }

  it("un viaje quieto, ya limpio, ni se lista en los barridos siguientes", async () => {
    const { servicio, listados, poner, purgar } = entorno();
    purgar(ADJ);
    poner(`${ADJ}.jpg`);
    const primero = await servicio.barrer(AHORA);
    expect([primero.huerfanosBorrados, primero.viajesSinCambios, listados()]).toEqual([1, 0, 1]);
    const segundo = await servicio.barrer(AHORA + HORA);
    expect([segundo.revisados, segundo.viajesSinCambios, listados()]).toEqual([0, 1, 1]);
    const tercero = await servicio.barrer(AHORA + 2 * HORA);
    expect([tercero.viajesSinCambios, listados()]).toEqual([1, 1]);
  });

  it("una operación nueva (una purga cambia la cabeza) hace que se vuelva a revisar y borre lo nuevo", async () => {
    const { almacen, archivos, servicio, purgar, listados, poner } = entorno();
    poner("notas.txt"); // la carpeta del viaje ya existe
    await servicio.barrer(AHORA);
    poner(`${ADJ}.jpg`);
    expect((await servicio.barrer(AHORA + HORA)).viajesSinCambios).toBe(1);
    expect(archivos.guardados.size).toBe(2);
    purgar(ADJ);
    unaOperacion(almacen);
    const r = await servicio.barrer(AHORA + 2 * HORA);
    expect([r.viajesSinCambios, r.huerfanosBorrados, listados()]).toEqual([0, 1, 2]);
    expect([...archivos.guardados.keys()]).toEqual([`${TRIP}/notas.txt`]);
  });

  it("si había archivos esperando la gracia, el viaje se revisa de nuevo aunque no haya operaciones, hasta que quede limpio", async () => {
    const { archivos, servicio, purgar, poner } = entorno();
    purgar(ADJ);
    poner(`${ADJ}.jpg`, 1000);
    const joven = await servicio.barrer(AHORA);
    expect([joven.huerfanosBorrados, archivos.guardados.size]).toEqual([0, 1]);
    const despues = await servicio.barrer(AHORA + HORA);
    expect([despues.viajesSinCambios, despues.huerfanosBorrados, archivos.guardados.size]).toEqual([0, 1, 0]);
    expect((await servicio.barrer(AHORA + 2 * HORA)).viajesSinCambios).toBe(1);
  });

  it("con archivos mezclados (uno esperando la gracia y otros ya resueltos) el viaje se revisa de nuevo hasta que todos estén resueltos", async () => {
    const { archivos, servicio, purgar, poner } = entorno();
    purgar(ADJ);
    poner("notas.txt");
    poner(`${TERCERO}.jpg`);
    poner(`${ADJ}.jpg`, 1000);
    const joven = await servicio.barrer(AHORA);
    expect([joven.huerfanosBorrados, joven.desconocidos, joven.sinRegistro]).toEqual([0, 1, 1]);
    const despues = await servicio.barrer(AHORA + HORA);
    expect([despues.viajesSinCambios, despues.huerfanosBorrados]).toEqual([0, 1]);
    expect([...archivos.guardados.keys()].sort()).toEqual([`${TRIP}/${TERCERO}.jpg`, `${TRIP}/notas.txt`].sort());
  });

  it("aunque no haya cambios, cada 24 horas el viaje se revisa completo y se borra lo que se hubiera escapado", async () => {
    expect(REVISION_COMPLETA_DEL_BARRIDO_MS).toBe(24 * 60 * 60 * 1000);
    const { archivos, servicio, purgar, poner, listados } = entorno();
    poner("notas.txt");
    await servicio.barrer(AHORA);
    // un archivo con lápida que llegó sin que cambiara la cabeza (una carrera entre una subida y una purga)
    purgar(ADJ);
    poner(`${ADJ}.jpg`);
    const antes = await servicio.barrer(AHORA + REVISION_COMPLETA_DEL_BARRIDO_MS - 1);
    expect([antes.viajesSinCambios, antes.huerfanosBorrados, listados()]).toEqual([1, 0, 1]);
    const justo = await servicio.barrer(AHORA + REVISION_COMPLETA_DEL_BARRIDO_MS);
    expect([justo.viajesSinCambios, justo.huerfanosBorrados, listados()]).toEqual([0, 1, 2]);
    expect([...archivos.guardados.keys()]).toEqual([`${TRIP}/notas.txt`]);
    // y el plazo cuenta desde esa revisión: enseguida vuelve a saltarse
    expect((await servicio.barrer(AHORA + REVISION_COMPLETA_DEL_BARRIDO_MS + HORA)).viajesSinCambios).toBe(1);
  });

  it("un archivo que falló al borrarse se reintenta en el barrido siguiente aunque no haya operaciones", async () => {
    const { archivos, servicio, purgar, poner } = entorno();
    purgar(ADJ);
    poner(`${ADJ}.jpg`);
    archivos.fallanAlBorrar.add(`${TRIP}/${ADJ}.jpg`);
    expect((await servicio.barrer(AHORA)).errores).toBe(1);
    archivos.fallanAlBorrar.clear();
    const r = await servicio.barrer(AHORA + HORA);
    expect([r.viajesSinCambios, r.huerfanosBorrados, r.errores]).toEqual([0, 1, 0]);
  });

  it("un viaje cuyo listado falló se reintenta en el siguiente barrido", async () => {
    const { archivos, servicio, purgar, poner } = entorno();
    purgar(ADJ);
    poner(`${ADJ}.jpg`);
    const bueno = archivos.listar;
    archivos.listar = async () => {
      throw new Error("no se puede listar");
    };
    expect((await servicio.barrer(AHORA)).errores).toBe(1);
    archivos.listar = bueno;
    const r = await servicio.barrer(AHORA + HORA);
    expect([r.viajesSinCambios, r.huerfanosBorrados]).toEqual([0, 1]);
  });

  it("un viaje que solo tiene archivos que no se tocan (desconocidos o sin registro) queda limpio y no se vuelve a listar", async () => {
    const { servicio, listados, poner } = entorno();
    poner("notas.txt");
    poner(`${TERCERO}.jpg`);
    const primero = await servicio.barrer(AHORA);
    expect([primero.desconocidos, primero.sinRegistro]).toEqual([1, 1]);
    expect([(await servicio.barrer(AHORA + HORA)).viajesSinCambios, listados()]).toEqual([1, 1]);
  });

  it("la actividad de un viaje no obliga a revisar a los otros", async () => {
    const A = "018f3a6e-0000-7000-8000-0000000000a1";
    const B = "018f3a6e-0000-7000-8000-0000000000b2";
    const almacenes = new Map([[A, new AlmacenMemoria()], [B, new AlmacenMemoria()]]);
    for (const [id, almacen] of almacenes) almacen.crearEntidad("trip", id);
    const archivos = new ArchivosEnMemoria(() => AHORA);
    const servicio = new ServicioDeAdjuntos({ almacenDe: (id) => almacenes.get(id) ?? new AlmacenMemoria(), archivos });
    archivos.poner(A, `${OTRO}.jpg`, 10, AHORA - HORA);
    archivos.poner(B, `${OTRO}.jpg`, 10, AHORA - HORA);
    await servicio.barrer(AHORA);
    unaOperacion(almacenes.get(A)!);
    const r = await servicio.barrer(AHORA + HORA);
    // el viaje A tuvo una operación y se revisa (su único archivo); el B, quieto, ni se lista
    expect([r.viajesSinCambios, r.revisados]).toEqual([1, 1]);
    almacenes.get(A)!.crearEntidad("attachment", TERCERO);
    archivos.poner(A, `${TERCERO}.jpg`, 10, AHORA - HORA);
    almacenes.get(A)!.terminar("attachment", TERCERO);
    unaOperacion(almacenes.get(A)!);
    const s = await servicio.barrer(AHORA + 2 * HORA);
    expect([s.viajesSinCambios, s.huerfanosBorrados]).toEqual([1, 1]);
  });

  it("la cabeza se toma antes de listar: una operación que llega durante el barrido se ve en el siguiente", async () => {
    const { almacen, archivos, servicio, listados, poner } = entorno();
    poner("notas.txt"); // la carpeta del viaje ya existe
    const original = archivos.listar;
    archivos.listar = async (tripId) => {
      unaOperacion(almacen); // llega una operación mientras se lista
      return original(tripId);
    };
    await servicio.barrer(AHORA);
    archivos.listar = original;
    const r = await servicio.barrer(AHORA + HORA);
    expect([r.viajesSinCambios, listados()]).toEqual([0, 2]);
  });

  it("tras un reinicio (otro servicio con la misma base) se revisa todo una vez", async () => {
    const { almacen, archivos, servicio, purgar, poner } = entorno();
    await servicio.barrer(AHORA);
    purgar(ADJ);
    poner(`${ADJ}.jpg`);
    const nuevo = new ServicioDeAdjuntos({ almacenDe: () => almacen, archivos });
    const r = await nuevo.barrer(AHORA + HORA);
    expect([r.viajesSinCambios, r.huerfanosBorrados]).toEqual([0, 1]);
  });
});
