import { describe, expect, it } from "vitest";
import { AHORA, entornoApi, type Alta } from "../ayudas/entornoApi.js";
import { jpeg, pdf, png, sha256, webp, type Mime } from "../ayudas/adjuntos.js";
import { MAX_BYTES_IMAGEN } from "../../src/dominio/operaciones/validacion.js";
import { coincideEtag } from "../../src/http/rutasAdjuntos.js";
import { LimiteDeSubidas } from "../../src/http/limiteDeSubidas.js";
import { connect } from "node:net";

const GASTO = "018f3a6e-2000-7000-8000-000000000001";
let contador = 0;
const marca = (a: Alta): string => { contador += 1; return `${(AHORA - 9000 + contador).toString(16).padStart(13, "0")}-${contador.toString(16).padStart(4, "0")}-${a.device_id}`; };
const uuid = (n: number): string => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function entorno(opciones: Parameters<typeof entornoApi>[0] = {}) {
  const e = entornoApi(opciones);
  const a = await e.crearViaje();
  const op = (a_: Alta, tipo: string, entidadTipo: string, entidadId: string, payload: object, n: number) => ({ op_id: `018f3a6e-9000-7000-8000-${String(n).padStart(12, "0")}`, type: tipo, entity_type: entidadTipo, entity_id: entidadId, hlc: marca(a_), payload });
  const subirOps = async (a_: Alta, ops: object[]) => {
    const r = await e.app.inject({ method: "POST", url: `/v1/trips/${a_.trip_id}/ops`, headers: e.con(a_.token), payload: { ops } });
    return r.json<{ resultados: { estado: string; razon?: string }[] }>().resultados;
  };
  const gasto = await subirOps(a, [op(a, "expense.create", "expense", GASTO, { monto_minor: 1000, moneda: "BRL", categoria_id: "otro", cuando_ocurrio: AHORA - 10_000, dia_imputado: "2027-02-18", concepto: "Cena" }, 500)]);
  if (gasto[0]?.estado !== "accepted") throw new Error(`el gasto no se aceptó: ${JSON.stringify(gasto)}`);
  let n = 600;
  /** Registra un adjunto (su `attachment.add` aceptado) del gasto y devuelve su id. */
  async function registrar(contenido: Buffer, mime: Mime, tieneMiniatura: 0 | 1 = 0, id = uuid(++n), dueno = GASTO): Promise<string> {
    const r = await subirOps(a, [op(a, "attachment.add", "attachment", id, { owner_tipo: "EXPENSE", owner_id: dueno, mime, bytes: contenido.length, sha256: sha256(contenido), tiene_miniatura: tieneMiniatura }, ++n)]);
    if (r[0]?.estado !== "accepted") throw new Error(`el adjunto no se aceptó: ${JSON.stringify(r)}`);
    return id;
  }
  const subir = (id: string, cuerpo: Buffer | string | undefined, o: { token?: string; trip?: string; tipo?: string; miniatura?: boolean } = {}) =>
    e.app.inject({ method: "PUT", url: `/v1/trips/${o.trip ?? a.trip_id}/attachments/${id}${o.miniatura === true ? "/thumb" : ""}`, headers: { ...e.con(o.token ?? a.token), "content-type": o.tipo ?? "application/octet-stream" }, payload: cuerpo });
  const bajar = (id: string, o: { token?: string; trip?: string; miniatura?: boolean; cabeceras?: Record<string, string> } = {}) =>
    e.app.inject({ method: "GET", url: `/v1/trips/${o.trip ?? a.trip_id}/attachments/${id}${o.miniatura === true ? "/thumb" : ""}`, headers: e.con(o.token ?? a.token, o.cabeceras) });
  return { e, a, registrar, subir, bajar, subirOps, op };
}
const codigo = (r: { json: <T>() => T }): string => r.json<{ error: { codigo: string } }>().error.codigo;

describe("PUT y GET de un adjunto", () => {
  it("sube el archivo (204) y se baja igual, con las cabeceras de un contenido que no cambia", async () => {
    const { registrar, subir, bajar } = await entorno();
    const b = jpeg(300);
    const id = await registrar(b, "image/jpeg");
    const s = await subir(id, b, { tipo: "image/jpeg" });
    expect(s.statusCode).toBe(204);
    expect(s.body).toBe("");
    const r = await bajar(id);
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(b)).toBe(true);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    expect(r.headers["content-length"]).toBe("300");
    expect(r.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(r.headers.etag).toBe(`"${sha256(b)}"`);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-disposition"]).toBe("inline");
    expect(r.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
  });

  it("sirve cada tipo con su Content-Type de la lista blanca, sin importar el tipo con el que se subió", async () => {
    const { registrar, subir, bajar } = await entorno();
    for (const [b, mime] of [[png(), "image/png"], [pdf(), "application/pdf"]] as const) {
      const id = await registrar(b, mime);
      expect((await subir(id, b, { tipo: "application/octet-stream" })).statusCode).toBe(204);
      expect((await bajar(id)).headers["content-type"]).toBe(mime);
    }
  });

  it("una miniatura se sube y se baja por /thumb como JPEG con su propia etiqueta", async () => {
    const { registrar, subir, bajar } = await entorno();
    const b = png(200);
    const id = await registrar(b, "image/png", 1);
    await subir(id, b, { tipo: "image/png" });
    const m = jpeg(64);
    expect((await subir(id, m, { tipo: "image/jpeg", miniatura: true })).statusCode).toBe(204);
    const r = await bajar(id, { miniatura: true });
    expect([r.statusCode, r.headers["content-type"], r.headers["content-length"], r.headers.etag]).toEqual([200, "image/jpeg", "64", `"${sha256(b)}-miniatura"`]);
    expect(r.rawPayload.equals(m)).toBe(true);
  });

  it("repetir la subida es 204 otra vez y no cambia lo guardado", async () => {
    const { registrar, subir, bajar, e } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    expect((await subir(id, b)).statusCode).toBe(204);
    expect(e.contador("adjuntos_subidos", { variante: "archivo", repetido: "no" })).toBe(1);
    expect(e.contador("adjuntos_subidos", { variante: "archivo", repetido: "si" })).toBeUndefined();
    expect(e.contador("adjuntos_bytes", { variante: "archivo" })).toBe(b.length);
    expect((await subir(id, b)).statusCode).toBe(204);
    expect(e.archivos.guardadosEnTotal).toBe(1);
    expect((await bajar(id)).rawPayload.equals(b)).toBe(true);
    expect(e.contador("adjuntos_subidos", { variante: "archivo", repetido: "no" })).toBe(1);
    expect(e.contador("adjuntos_subidos", { variante: "archivo", repetido: "si" })).toBe(1);
    // lo repetido no suma bytes: no se escribió nada
    expect(e.contador("adjuntos_bytes", { variante: "archivo" })).toBe(b.length);
  });

  it("sube un archivo de tamaño real (300 KB) y un PDF justo en el tope de 10 MB", async () => {
    const { registrar, subir, bajar } = await entorno();
    const foto = jpeg(300_000, 2000, 1500);
    const idFoto = await registrar(foto, "image/jpeg");
    expect((await subir(idFoto, foto, { tipo: "image/jpeg" })).statusCode).toBe(204);
    const documento = pdf(10 * 1024 * 1024);
    const idPdf = await registrar(documento, "application/pdf");
    expect((await subir(idPdf, documento, { tipo: "application/pdf" })).statusCode).toBe(204);
    expect((await bajar(idPdf)).rawPayload.length).toBe(10 * 1024 * 1024);
  });

  it("acepta cada Content-Type de la lista blanca y la subida queda en el registro y en las métricas de bytes", async () => {
    const { registrar, subir, e, a, subirOps, op } = await entorno();
    const otroGasto = "018f3a6e-2000-7000-8000-000000000002";
    await subirOps(a, [op(a, "expense.create", "expense", otroGasto, { monto_minor: 500, moneda: "BRL", categoria_id: "otro", cuando_ocurrio: AHORA - 10_000, dia_imputado: "2027-02-18" }, 800)]);
    let total = 0;
    for (const [b, mime] of [[jpeg(120), "image/jpeg"], [png(130), "image/png"], [webp(140), "image/webp"], [pdf(150), "application/pdf"]] as const) {
      const id = await registrar(b, mime, 0, uuid(++contador), mime === "application/pdf" ? otroGasto : GASTO);
      expect([mime, (await subir(id, b, { tipo: mime })).statusCode]).toEqual([mime, 204]);
      total += b.length;
    }
    expect(e.contador("adjuntos_bytes", { variante: "archivo" })).toBe(total);
    const subidas = e.registro.entradas.filter((x) => x.evento === "adjunto_subido");
    expect(subidas).toHaveLength(4);
    expect(subidas[0]?.campos).toMatchObject({ variante: "archivo", bytes: 120, repetido: false });
    expect(JSON.stringify(subidas)).not.toContain("aaaaaaaa-0000-4000-8000-0000000006");
  });

  it("al responder 304 cierra el archivo que había abierto", async () => {
    const { registrar, subir, bajar, e } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    await subir(id, b);
    await bajar(id, { cabeceras: { "if-none-match": `"${sha256(b)}"` } });
    expect(e.archivos.abiertos).toHaveLength(1);
    expect(e.archivos.abiertos[0]?.destroyed).toBe(true);
  });

  it("If-None-Match con la etiqueta responde 304 sin cuerpo y con las cabeceras de caché; con otra, el archivo", async () => {
    const { registrar, subir, bajar } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    await subir(id, b);
    const etag = `"${sha256(b)}"`;
    const igual = await bajar(id, { cabeceras: { "if-none-match": etag } });
    expect([igual.statusCode, igual.body]).toEqual([304, ""]);
    expect(igual.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(igual.headers.etag).toBe(etag);
    expect(igual.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect((await bajar(id, { cabeceras: { "if-none-match": `W/${etag}` } })).statusCode).toBe(304);
    expect((await bajar(id, { cabeceras: { "if-none-match": `"otra", ${etag}` } })).statusCode).toBe(304);
    expect((await bajar(id, { cabeceras: { "if-none-match": "*" } })).statusCode).toBe(304);
    expect((await bajar(id, { cabeceras: { "if-none-match": '"otra"' } })).statusCode).toBe(200);
  });
});

describe("errores de subida", () => {
  it("un adjunto que nadie registró es 409 adjunto_no_registrado y no se guarda nada", async () => {
    const { subir, e } = await entorno();
    const r = await subir(uuid(999), jpeg());
    expect([r.statusCode, codigo(r)]).toEqual([409, "adjunto_no_registrado"]);
    expect(e.archivos.guardadosEnTotal).toBe(0);
  });

  it("un attachment.add rechazado por el límite de 3 deja el PUT de ese adjunto en 409", async () => {
    const { a, registrar, subirOps, op, subir } = await entorno();
    const b = jpeg();
    for (let i = 0; i < 3; i++) await registrar(b, "image/jpeg");
    const cuarto = uuid(900);
    const r = await subirOps(a, [op(a, "attachment.add", "attachment", cuarto, { owner_tipo: "EXPENSE", owner_id: GASTO, mime: "image/jpeg", bytes: b.length, sha256: sha256(b), tiene_miniatura: 0 }, 901)]);
    expect(r[0]).toMatchObject({ estado: "rejected", razon: "limite_superado" });
    const p = await subir(cuarto, b);
    expect([p.statusCode, codigo(p)]).toEqual([409, "adjunto_no_registrado"]);
  });

  it("lo que no es JPEG, PNG, WebP o PDF es 415 tipo_no_permitido, también si el cliente dice que es una imagen", async () => {
    const { registrar, subir } = await entorno();
    const id = await registrar(jpeg(), "image/jpeg");
    for (const malo of [Buffer.from("GIF89a" + "x".repeat(100)), Buffer.from("<script>alert(1)</script>"), Buffer.alloc(0)]) {
      const r = await subir(id, malo, { tipo: "image/jpeg" });
      expect([r.statusCode, codigo(r)]).toEqual([415, "tipo_no_permitido"]);
    }
  });

  it("un Content-Type que no es de archivo es 415 tipo_no_permitido", async () => {
    const { registrar, subir } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    for (const tipo of ["text/plain", "text/html", "image/gif", "multipart/form-data; boundary=x"]) {
      const r = await subir(id, b, { tipo });
      expect([tipo, r.statusCode, codigo(r)]).toEqual([tipo, 415, "tipo_no_permitido"]);
    }
  });

  it("con Content-Type JSON: un JSON válido no es un archivo (415) y bytes que no son JSON son un 400", async () => {
    const { registrar, subir } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    const valido = await subir(id, "{}", { tipo: "application/json" });
    expect([valido.statusCode, codigo(valido)]).toEqual([415, "tipo_no_permitido"]);
    const invalido = await subir(id, b, { tipo: "application/json" });
    expect([invalido.statusCode, codigo(invalido)]).toEqual([400, "formato_invalido"]);
  });

  it("el tamaño o la huella distintos de lo declarado son 400 y 422", async () => {
    const { registrar, subir } = await entorno();
    const b = jpeg(200);
    const id = await registrar(b, "image/jpeg");
    const mas = await subir(id, jpeg(201));
    expect([mas.statusCode, codigo(mas)]).toEqual([400, "formato_invalido"]);
    const otro = Buffer.from(b);
    otro[100] = 1;
    const hash = await subir(id, otro);
    expect([hash.statusCode, codigo(hash)]).toEqual([422, "hash_no_coincide"]);
  });

  it("un archivo de más del tope es 413 adjunto_demasiado_grande, tanto por el cuerpo como por el tipo", async () => {
    const { registrar, subir } = await entorno();
    const b = jpeg(100);
    const id = await registrar(b, "image/jpeg");
    // más de 10 MB: lo corta el límite de la ruta
    const enorme = await subir(id, Buffer.alloc(11 * 1024 * 1024, 1));
    expect([enorme.statusCode, codigo(enorme)]).toEqual([413, "adjunto_demasiado_grande"]);
    // entre 5 y 10 MB para una imagen: lo corta el servicio
    const grande = jpeg(MAX_BYTES_IMAGEN + 10);
    const id2 = await registrar(b, "image/jpeg");
    const r = await subir(id2, grande);
    expect([r.statusCode, codigo(r)]).toEqual([413, "adjunto_demasiado_grande"]);
  });

  it("un id mal formado al bajar también es 400 (no 404)", async () => {
    const { e, a } = await entorno();
    for (const malo of ["no-es-uuid", "AAAAAAAA-0000-4000-8000-000000000001"]) {
      for (const sufijo of ["", "/thumb"]) {
        const r = await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/attachments/${malo}${sufijo}`, headers: e.con(a.token) });
        expect([malo, sufijo, r.statusCode]).toEqual([malo, sufijo, 400]);
      }
    }
  });

  it("sin token es 401 antes de leer el cuerpo, con el token de otro viaje 404, y un id mal formado 400", async () => {
    const { e, a, registrar, subir } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    expect((await e.app.inject({ method: "PUT", url: `/v1/trips/${a.trip_id}/attachments/${id}`, headers: { "content-type": "application/octet-stream" }, payload: b })).statusCode).toBe(401);
    const otro = await e.crearViaje();
    expect((await subir(id, b, { token: otro.token })).statusCode).toBe(404);
    for (const malo of ["no-es-uuid", "..%2F..%2Fetc%2Fpasswd", "AAAAAAAA-0000-4000-8000-000000000001"]) {
      const r = await e.app.inject({ method: "PUT", url: `/v1/trips/${a.trip_id}/attachments/${malo}`, headers: { ...e.con(a.token), "content-type": "application/octet-stream" }, payload: b });
      expect([malo, r.statusCode]).toEqual([malo, 400]);
    }
  });

  it("un archivo roto, con contenido activo o de dimensiones enormes se rechaza aunque la firma y la huella estén bien", async () => {
    const { registrar, subir, e } = await entorno();
    const cortado = jpeg(300).subarray(0, 298);
    const idCortado = await registrar(cortado, "image/jpeg");
    const r1 = await subir(idCortado, cortado, { tipo: "image/jpeg" });
    expect([r1.statusCode, codigo(r1)]).toEqual([415, "tipo_no_permitido"]);
    const activo = Buffer.from("%PDF-1.7\n1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n%%EOF\n");
    const idActivo = await registrar(activo, "application/pdf");
    const r2 = await subir(idActivo, activo, { tipo: "application/pdf" });
    expect([r2.statusCode, codigo(r2), r2.json<{ error: { mensaje: string } }>().error.mensaje]).toEqual([415, "tipo_no_permitido", "el PDF tiene contenido activo"]);
    const enorme = png(400, 30000, 30000);
    const idEnorme = await registrar(enorme, "image/png");
    const r3 = await subir(idEnorme, enorme, { tipo: "image/png" });
    expect([r3.statusCode, codigo(r3)]).toEqual([413, "adjunto_demasiado_grande"]);
    expect(e.archivos.guardadosEnTotal).toBe(0);
  });

  it("una miniatura rota o de más de 1024 px se rechaza", async () => {
    const { registrar, subir } = await entorno();
    const id = await registrar(png(), "image/png", 1);
    const rota = await subir(id, jpeg(100).subarray(0, 98), { miniatura: true });
    expect([rota.statusCode, codigo(rota)]).toEqual([415, "tipo_no_permitido"]);
    const grande = await subir(id, jpeg(100, 2000, 2000), { miniatura: true });
    expect([grande.statusCode, codigo(grande)]).toEqual([413, "adjunto_demasiado_grande"]);
  });

  it("la miniatura sin haberla declarado es 400, y una que no es JPEG es 415", async () => {
    const { registrar, subir } = await entorno();
    const sin = await registrar(png(), "image/png", 0);
    expect((await subir(sin, jpeg(50), { miniatura: true })).statusCode).toBe(400);
    const con = await registrar(png(), "image/png", 1);
    const r = await subir(con, png(50), { miniatura: true });
    expect([r.statusCode, codigo(r)]).toEqual([415, "tipo_no_permitido"]);
  });
});

describe("errores de bajada y aislamiento", () => {
  it("registrado sin archivo es 404 no_subido; uno que no existe, 404 no_existe", async () => {
    const { registrar, bajar } = await entorno();
    const id = await registrar(jpeg(), "image/jpeg", 1);
    expect([(await bajar(id)).statusCode, codigo(await bajar(id))]).toEqual([404, "no_subido"]);
    expect(codigo(await bajar(id, { miniatura: true }))).toBe("no_subido");
    const nada = await bajar(uuid(998));
    expect([nada.statusCode, codigo(nada)]).toEqual([404, "no_existe"]);
  });

  it("un adjunto de otro viaje no se ve ni se baja: 404 con el token del otro, y no aparece en su viaje", async () => {
    const { e, registrar, subir, bajar } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    await subir(id, b);
    const otro = await e.crearViaje();
    expect((await bajar(id, { token: otro.token })).statusCode).toBe(404);
    const propio = await e.app.inject({ method: "GET", url: `/v1/trips/${otro.trip_id}/attachments/${id}`, headers: e.con(otro.token) });
    expect([propio.statusCode, codigo(propio)]).toEqual([404, "no_existe"]);
  });

  it("sin token es 401 y un dispositivo revocado también", async () => {
    const { e, a, registrar, subir, bajar } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    await subir(id, b);
    expect((await e.app.inject({ method: "GET", url: `/v1/trips/${a.trip_id}/attachments/${id}` })).statusCode).toBe(401);
    const otro = await e.sumar(a);
    expect((await bajar(id, { token: otro.token })).statusCode).toBe(200);
    await e.app.inject({ method: "POST", url: `/v1/trips/${a.trip_id}/devices/${otro.device_id}/revoke`, headers: e.con(a.token) });
    expect((await bajar(id, { token: otro.token })).statusCode).toBe(401);
  });

  it("cualquier dispositivo del viaje ve los adjuntos que subió otro", async () => {
    const { e, a, registrar, subir, bajar } = await entorno();
    const b = png(150);
    const id = await registrar(b, "image/png");
    await subir(id, b);
    const ana = await e.sumar(a);
    expect((await bajar(id, { token: ana.token })).rawPayload.equals(b)).toBe(true);
  });

  it("un adjunto eliminado para siempre deja de existir", async () => {
    const { e, a, registrar, subir, bajar, subirOps, op } = await entorno();
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    await subir(id, b);
    const r = await subirOps(a, [op(a, "expense.purge", "expense", GASTO, {}, 700)]);
    expect(r[0]?.estado).toBe("accepted");
    const x = await bajar(id);
    expect([x.statusCode, codigo(x)]).toEqual([404, "no_existe"]);
    expect(e.canal.conexiones()).toBe(0);
  });
});

describe("purgar un gasto y barrer", () => {
  it("los archivos del adjunto purgado se borran en el barrido, los de los otros se conservan y el espacio se libera", async () => {
    const { e, a, registrar, subir, bajar, subirOps, op } = await entorno();
    const fotoA = png(400);
    const fotoB = jpeg(300);
    const idA = await registrar(fotoA, "image/png", 1);
    const idB = await registrar(fotoB, "image/jpeg", 0);
    await subir(idA, fotoA, { tipo: "image/png" });
    await subir(idA, jpeg(60), { miniatura: true });
    await subir(idB, fotoB, { tipo: "image/jpeg" });
    expect(e.archivos.guardados.size).toBe(3);
    // el adjunto A es de otro gasto: se purga ese gasto y el B sigue vivo
    const otroGasto = "018f3a6e-2000-7000-8000-000000000002";
    const idC = uuid(950);
    await subirOps(a, [op(a, "expense.create", "expense", otroGasto, { monto_minor: 100, moneda: "BRL", categoria_id: "otro", cuando_ocurrio: AHORA - 10_000, dia_imputado: "2027-02-18" }, 940)]);
    const fotoC = pdf(500);
    await subirOps(a, [op(a, "attachment.add", "attachment", idC, { owner_tipo: "EXPENSE", owner_id: otroGasto, mime: "application/pdf", bytes: fotoC.length, sha256: sha256(fotoC), tiene_miniatura: 0 }, 941)]);
    await subir(idC, fotoC, { tipo: "application/pdf" });
    expect((await subirOps(a, [op(a, "expense.purge", "expense", otroGasto, {}, 942)]))[0]?.estado).toBe("accepted");
    expect((await bajar(idC)).statusCode).toBe(404);
    // todavía no pasó la gracia: no se toca nada
    expect((await e.adjuntos.barrer(Date.now())).huerfanosBorrados).toBe(0);
    expect(e.archivos.guardados.size).toBe(4);
    const r = await e.adjuntos.barrer(Date.now() + 61 * 60 * 1000);
    expect([r.huerfanosBorrados, r.bytesLiberados]).toEqual([1, 500]);
    expect(e.archivos.guardados.size).toBe(3);
    expect((await e.archivos.bytesDelViaje(a.trip_id))).toBe(400 + 60 + 300);
    expect((await bajar(idA)).statusCode).toBe(200);
    expect((await bajar(idB)).statusCode).toBe(200);
  });
});

describe("límite de subidas simultáneas", () => {
  const libre = () => new AbortController().signal;
  const hasta = async (condicion: () => boolean, ms = 2000) => {
    for (let i = 0; i < ms / 20 && !condicion(); i++) await new Promise((ok) => setTimeout(ok, 20));
    return condicion();
  };

  it("con el lugar ocupado y sin cola es 503 servidor_ocupado con Retry-After, no guarda nada, y al liberarse sube", async () => {
    const limite = new LimiteDeSubidas(1, 0);
    const { e, registrar, subir } = await entorno({ limiteDeSubidas: limite });
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    const liberar = await limite.pedir(1000, libre());
    const r = await subir(id, b);
    expect([r.statusCode, codigo(r), r.headers["retry-after"]]).toEqual([503, "servidor_ocupado", "10"]);
    expect(e.archivos.guardadosEnTotal).toBe(0);
    expect(e.contador("adjuntos_sin_lugar", {})).toBe(1);
    expect(e.registro.entradas.some((x) => x.evento === "subida_sin_lugar" && x.nivel === "warn")).toBe(true);
    liberar();
    expect((await subir(id, b)).statusCode).toBe(204);
  });

  it("una subida que espera en la cola sigue cuando se libera el lugar", async () => {
    const limite = new LimiteDeSubidas(1, 1);
    const { registrar, subir } = await entorno({ limiteDeSubidas: limite });
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    const liberar = await limite.pedir(1000, libre());
    const pendiente = subir(id, b);
    expect(await hasta(() => limite.enEspera === 1)).toBe(true);
    liberar();
    expect((await pendiente).statusCode).toBe(204);
  });

  it("el lugar se libera después de cada respuesta, también de las que fallan (409, 415, 422, 413)", async () => {
    const limite = new LimiteDeSubidas(1, 0);
    const { registrar, subir } = await entorno({ limiteDeSubidas: limite });
    const b = jpeg(200);
    const id = await registrar(b, "image/jpeg");
    const otro = Buffer.from(b);
    otro[100] = 1;
    const estados: number[] = [];
    for (const [destino, cuerpo] of [[uuid(990), b], [id, Buffer.from("GIF89a" + "x".repeat(100))], [id, otro], [id, Buffer.alloc(11 * 1024 * 1024, 1)], [id, b], [id, b]] as const) {
      estados.push((await subir(destino, cuerpo)).statusCode);
    }
    expect(estados).toEqual([409, 415, 422, 413, 204, 204]);
    expect(await hasta(() => limite.ocupados === 0)).toBe(true);
  });

  it("sin token es 401 aunque esté lleno (la autenticación va antes) y no entra en la cola", async () => {
    const limite = new LimiteDeSubidas(1, 3);
    const { e, a, registrar } = await entorno({ limiteDeSubidas: limite });
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    await limite.pedir(1000, libre());
    const r = await e.app.inject({ method: "PUT", url: `/v1/trips/${a.trip_id}/attachments/${id}`, headers: { "content-type": "application/octet-stream" }, payload: b });
    expect(r.statusCode).toBe(401);
    expect(limite.enEspera).toBe(0);
  });

  it("un pedido abortado no deja ningún lugar ocupado", async () => {
    const limite = new LimiteDeSubidas(1, 0);
    const { e, a, registrar } = await entorno({ limiteDeSubidas: limite });
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    await e.app
      .inject({ method: "PUT", url: `/v1/trips/${a.trip_id}/attachments/${id}`, headers: { ...e.con(a.token), "content-type": "application/octet-stream" }, payload: b, signal: AbortSignal.abort() })
      .catch(() => undefined);
    await new Promise((ok) => setTimeout(ok, 50));
    expect([limite.ocupados, limite.enEspera]).toEqual([0, 0]);
    expect(e.archivos.guardadosEnTotal).toBe(0);
  });

  it("bajar un archivo no pasa por el límite", async () => {
    const limite = new LimiteDeSubidas(1, 0);
    const { registrar, subir, bajar } = await entorno({ limiteDeSubidas: limite });
    const b = jpeg();
    const id = await registrar(b, "image/jpeg");
    expect((await subir(id, b)).statusCode).toBe(204);
    await limite.pedir(1000, libre());
    expect((await bajar(id)).statusCode).toBe(200);
  });

  it("un cliente que corta la conexión a mitad de la subida, o mientras espera su turno, devuelve su lugar", async () => {
    const limite = new LimiteDeSubidas(1, 1);
    const { e, a, registrar } = await entorno({ limiteDeSubidas: limite });
    const b = jpeg(2000);
    const id = await registrar(b, "image/jpeg");
    await e.app.listen({ port: 0, host: "127.0.0.1" });
    const puerto = (e.app.server.address() as { port: number }).port;
    const empezar = () => {
      const socket = connect(puerto, "127.0.0.1");
      socket.on("error", () => undefined);
      socket.write(`PUT /v1/trips/${a.trip_id}/attachments/${id} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${a.token}\r\nContent-Type: application/octet-stream\r\nContent-Length: ${b.length}\r\n\r\n`);
      socket.write(b.subarray(0, 100)); // manda una parte y se queda colgado
      return socket;
    };
    try {
      const primero = empezar();
      expect(await hasta(() => limite.ocupados === 1)).toBe(true);
      const segundo = empezar();
      expect(await hasta(() => limite.enEspera === 1)).toBe(true);
      segundo.destroy();
      expect(await hasta(() => limite.enEspera === 0)).toBe(true);
      expect(limite.ocupados).toBe(1);
      // irse mientras espera no es "sin lugar": no cuenta en la métrica ni deja aviso
      expect(e.contador("adjuntos_sin_lugar", {})).toBeUndefined();
      expect(e.registro.entradas.some((x) => x.evento === "subida_sin_lugar")).toBe(false);
      primero.destroy();
      expect(await hasta(() => limite.ocupados === 0)).toBe(true);
    } finally {
      await e.app.close();
    }
  });
});

describe("coincideEtag", () => {
  it("compara con una o varias etiquetas, débiles o con *", () => {
    expect(coincideEtag(undefined, '"a"')).toBe(false);
    expect(coincideEtag('"a"', '"a"')).toBe(true);
    expect(coincideEtag('"b"', '"a"')).toBe(false);
    expect(coincideEtag('W/"a"', '"a"')).toBe(true);
    expect(coincideEtag('"b" , "a"', '"a"')).toBe(true);
    expect(coincideEtag("*", '"a"')).toBe(true);
    expect(coincideEtag("", '"a"')).toBe(false);
  });
});
