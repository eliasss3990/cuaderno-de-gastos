import { describe, expect, it } from "vitest";
import { abreviarId, pareceUnDato, leerNivel, limpiarCampos, limpiarError, marcarLimpio, OCULTO, registroNulo, rutaSinConsulta } from "../../src/observabilidad/registro.js";

/** Un token de dispositivo (256 bits en base64url: 43 caracteres), para probar que se reconoce por su forma. */
const TOKEN = "Zk3vQ9-xL2mN8_pR5tW7yB1cD4fG6hJ0aS2eU3iO9kA";

describe("limpiarCampos: lo que nunca llega a un log", () => {
  it("oculta los campos prohibidos aunque cambien las mayúsculas o los separadores", () => {
    const r = limpiarCampos({
      payload: { monto: 5000 },
      token: "t",
      "X-Token": "t",
      x_token: "t",
      Authorization: "Bearer t",
      codigo: "ABCD2345",
      monto: 1,
      nota: "cena",
      lat: -25.3,
      lng: -57.6,
      latitud: 1,
      longitude: 2,
      pepper: "p",
      Password: "p",
      cookie: "c",
      "set-cookie": "c",
    });
    for (const [clave, valor] of Object.entries(r)) expect([clave, valor]).toEqual([clave, OCULTO]);
    expect(Object.keys(r)).toHaveLength(16);
  });

  it("oculta todos los nombres de la lista cerrada (escrita entera aquí a propósito: quitar uno de la lista debe romper este test)", () => {
    const nombres = [
      "payload", "body", "cuerpo", "data", "datos", "pepper", "clave", "pass", "pwd", "contrasena", "key", "salt", "sig", "otp", "pin", "auth",
      "amount", "valor", "value", "monto", "importe", "price", "precio", "cost", "costo", "gasto", "gastos", "expense", "expenses",
      "descripcion", "description", "nota", "notas", "note", "notes", "email", "correo", "telefono", "phone",
      "location", "ubicacion", "coords", "coordinates", "gps", "lat", "lng", "lon", "latitud", "longitud", "latitude", "longitude",
      "bindings", "values", "rows", "content",
      "passphrase", "mnemonic", "seed", "hmac", "nonce", "cvv", "iban", "dni", "totp", "cred", "creds", "ciphertext", "auth_header", "x-auth",
      "url", "href", "link", "shareLink", "uri", "dsn", "connectionString",
    ];
    const r = limpiarCampos(Object.fromEntries(nombres.map((n) => [n, "VALOR-SECRETO"])));
    for (const n of nombres) expect([n, r[n]]).toEqual([n, OCULTO]);
    expect(JSON.stringify(r)).not.toContain("VALOR-SECRETO");
  });

  it("las credenciales se ocultan por contención: cualquier nombre que incluya token, secret, passw, cookie, authoriz, apikey, bearer, jwt, session o credential", () => {
    const nombres = [
      "token", "tokenHash", "token2", "mi_token", "accessToken", "access_token", "X-Token", "idToken", // token
      "secret", "client_secret", "SECRET_KEY", // secret
      "password", "passwd", "Passw0rd", // passw
      "cookie", "Set-Cookie", "cookies", // cookie
      "authorization", "proxy-authorization", "Authorization", // authoriz
      "apikey", "api_key", "x-api-key", // apikey
      "bearer", "bearerToken2", "mi_bearer", // bearer
      "jwt", "jwt_firmado", "JWT", // jwt
      "session", "sessionId", "mi_session", // session
      "credential", "credentials", "userCredential", // credential
    ];
    const r = limpiarCampos(Object.fromEntries(nombres.map((n) => [n, "VALOR-SECRETO"])));
    for (const n of nombres) expect([n, r[n]]).toEqual([n, OCULTO]);
  });

  it("los códigos se ocultan por el nombre: empieza por codigo o termina en code; y por invit", () => {
    const nombres = ["codigo", "codigo_viaje", "codigoDeInvitacion", "code", "inviteCode", "invitationCode", "joinCode", "tripCode", "invite", "invitacion", "privateKey", "private_key", "signature"];
    const r = limpiarCampos(Object.fromEntries(nombres.map((n) => [n, "VALOR-SECRETO"])));
    for (const n of nombres) expect([n, r[n]]).toEqual([n, OCULTO]);
    // lo que solo se parece no se oculta
    const visibles = { decodificado: 1, encodeado: 2, codificacion: 3, descodificar: 4, decodigo: 5 };
    expect(limpiarCampos(visibles)).toEqual(visibles);
  });

  it("cada alternativa de la regla por contención se prueba sola (un nombre que solo contiene esa palabra)", () => {
    for (const nombre of ["xxtokenxx", "xxsecretxx", "xxpasswxx", "xxcookiexx", "xxauthorizxx", "xxapikeyxx", "xxbearerxx", "xxjwtxx", "xxsessionxx", "xxcredentialxx", "xxinvitxx", "xxprivatekeyxx", "xxsignaturexx"]) {
      expect([nombre, limpiarCampos({ [nombre]: "v" })[nombre]]).toEqual([nombre, OCULTO]);
    }
  });

  it("los oculta también dentro de objetos y listas, a cualquier profundidad", () => {
    const r = limpiarCampos({ req: { headers: { authorization: "Bearer secreto" }, elementos: [{ nota: "x", ok: 1 }] }, a: { b: { c: { d: { token: "t", visible: "v" } } } } });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(r).toEqual({ req: { headers: { authorization: OCULTO }, elementos: [{ nota: OCULTO, ok: 1 }] }, a: { b: { c: { d: { token: OCULTO, visible: "v" } } } } });
  });

  it("deja pasar lo demás, incluido lo que solo se parece (intentos_invalidos, notas_len)", () => {
    const campos = { evento: "x", intentos_invalidos: 3, notas_len: 2, ruta: "/join", status: 401, ms: 12.5, trip_id: "0193b4c2", motivo: "viaje_cerrado", n: 0, ok: false, nada: null, falta: undefined };
    expect(limpiarCampos(campos)).toEqual(campos);
  });

  it("no modifica lo que recibe", () => {
    const entrada = { token: "t", anidado: { nota: "n" } };
    limpiarCampos(entrada);
    expect(entrada).toEqual({ token: "t", anidado: { nota: "n" } });
  });

  it("corta los textos largos y las listas largas", () => {
    const r = limpiarCampos({ texto: "a".repeat(1500), lista: Array.from({ length: 150 }, (_, i) => i) });
    expect((r.texto as string).startsWith("a".repeat(1000))).toBe(true);
    expect((r.texto as string).length).toBeLessThan(1100);
    expect(r.texto).toContain("500 más");
    expect((r.lista as unknown[]).length).toBe(101);
    expect((r.lista as unknown[])[100]).toBe("[50 más]");
    expect(limpiarCampos({ t: "a".repeat(1000) }).t).toBe("a".repeat(1000)); // en el borde no corta
  });

  it("conserva 6 niveles de anidación y corta el séptimo", () => {
    /** `k` objetos anidados; el más profundo lleva `fin`. */
    const anidar = (k: number) => {
      let o: Record<string, unknown> = { fin: true };
      for (let i = 1; i < k; i++) o = { c: o };
      return { c: o };
    };
    expect(JSON.stringify(limpiarCampos(anidar(6)))).toContain('"fin":true');
    expect(JSON.stringify(limpiarCampos(anidar(6)))).not.toContain("demasiado profundo");
    expect(JSON.stringify(limpiarCampos(anidar(7)))).toContain("[demasiado profundo]");
    expect(JSON.stringify(limpiarCampos(anidar(7)))).not.toContain("fin");
  });

  it("una lista de exactamente 100 elementos no se corta ni agrega aviso; con 101 sí", () => {
    expect(limpiarCampos({ l: Array.from({ length: 100 }, (_, i) => i) }).l).toHaveLength(100);
    expect(limpiarCampos({ l: Array.from({ length: 101 }, (_, i) => i) }).l).toHaveLength(101);
    expect((limpiarCampos({ l: Array.from({ length: 101 }, (_, i) => i) }).l as unknown[])[100]).toBe("[1 más]");
  });

  it("un objeto de exactamente 100 campos no se corta", () => {
    const cien = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    const r = limpiarCampos(cien);
    expect(Object.keys(r)).toHaveLength(100);
    expect(r).not.toHaveProperty("[más]");
  });

  it("si ni siquiera se pueden leer los nombres de los campos (un Proxy que falla), no lanza", () => {
    const hostil = new Proxy({}, { ownKeys: () => { throw new Error("no se puede"); } });
    expect(limpiarCampos(hostil)).toEqual({ campos: "[ilegibles]" });
  });

  it("corta los objetos con demasiados campos", () => {
    const grande = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, i]));
    const r = limpiarCampos(grande);
    expect(Object.keys(r)).toHaveLength(101);
    expect(r["[más]"]).toBe(true);
  });

  it("nunca lanza: referencias circulares, getters que fallan, profundidad, tipos raros", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.yo = circular;
    const conGetter = {
      get roto(): string {
        throw new Error("no se puede leer");
      },
      bien: 1,
    };
    let hondo: Record<string, unknown> = { fin: true };
    for (let i = 0; i < 20; i++) hondo = { dentro: hondo };
    const r = limpiarCampos({ circular, conGetter, hondo, f: () => 1, s: Symbol("x"), g: 12345678901234567890n, d: new Date(0), mala: new Date("x"), m: new Map([[1, 2]]) });
    expect((r.circular as Record<string, unknown>).yo).toBe("[circular]");
    expect(r.conGetter).toEqual({ roto: "[ilegible]", bien: 1 });
    expect(JSON.stringify(r.hondo)).toContain("demasiado profundo");
    expect(r.f).toBe("[function]");
    expect(r.s).toBe("[symbol]");
    expect(r.g).toBe("12345678901234567890");
    expect(r.d).toBe("1970-01-01T00:00:00.000Z");
    expect(r.mala).toBe("[fecha inválida]");
    expect(r.m).toBe("[Map 1]");
  });

  it("una misma referencia usada dos veces (no circular) se escribe las dos veces", () => {
    const compartido = { v: 1 };
    expect(limpiarCampos({ a: compartido, b: compartido })).toEqual({ a: { v: 1 }, b: { v: 1 } });
  });

  it("el nombre de un error y un String envuelto también se limpian", () => {
    const err = Object.assign(new Error("x"), { name: "token=SECRETO33" });
    expect(limpiarError(err).type).toBe("token=[oculto]");
    // eslint-disable-next-line no-new-wrappers
    expect(limpiarCampos({ s: new String("token=SECRETO") }).s).toBe("token=[oculto]");
  });

  it("un objeto marcado como limpio pasa tal cual (sin cortar, sin ocultar) y una copia sin marcar se limpia", () => {
    const grande = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`serie{code=${i}}`, i]));
    const marcado = marcarLimpio({ ...grande, token_invalido: 3 });
    const r = limpiarCampos({ m: marcado }).m as Record<string, number>;
    expect(r).toBe(marcado);
    expect(Object.keys(r)).toHaveLength(151);
    expect(r.token_invalido).toBe(3);
    // sin la marca, el mismo contenido se trata como texto libre: las claves se mutilan y colapsan, y `token_invalido` pierde su valor
    const copia = limpiarCampos({ m: { token_invalido: 3, "serie{code=1}": 1, "serie{code=2}": 2 } }).m as Record<string, unknown>;
    expect(Object.keys(copia)).toEqual(["token_invalido", "serie{code=[oculto]"]);
    expect(copia.token_invalido).toBe(OCULTO);
  });

  it("pareceUnDato reconoce un token, una corrida larga (sha256, UUID, base64), muchos dígitos y el comienzo de un JWT", () => {
    for (const dato of [TOKEN, `/join/${TOKEN}`, "a".repeat(32), "0123456789abcdef".repeat(4), "0193b4c2-7e1f-7abc-8def-0123456789ab", "abcdefgh-abcdefgh-abcdefgh-abcdefgh", "123456789", "600.123.456", "600-123-456", "600/123/456", "1:2:3:4:5:6:7:8:9", "5491155551234", "eyJhbGciOiJ.eyJzdWIiOiIx.abc", "x".repeat(60)]) {
      expect([dato, pareceUnDato(dato)]).toEqual([dato, true]);
    }
    for (const nombre of ["", "viaje_cerrado", "dependiente_de_op_rechazada", "/v1/trips/:trip/ops", "a".repeat(31), "abcdefgh-abcdefgh-abcdefgh-abc", "12345678", "1.2.3", "2026-11", "eyJ", "eyJab.x", "get", "200"]) {
      expect([nombre, pareceUnDato(nombre)]).toEqual([nombre, false]);
    }
    expect(pareceUnDato(TOKEN)).toBe(true); // sin estado entre llamadas
    expect(pareceUnDato(TOKEN)).toBe(true);
  });

  it("serializa un error con su tipo, mensaje y pila (la forma estándar de pino)", () => {
    const r = limpiarCampos({ err: new RangeError("falló") }) as { err: { type: string; message: string; stack: string } };
    expect(r.err.type).toBe("RangeError");
    expect(r.err.message).toBe("falló");
    expect(r.err.stack).toContain("RangeError");
  });

  it("oculta en los textos lo que se reconoce por su forma: Bearer, parámetros de URL y tokens", () => {
    const r = limpiarCampos({
      a: "Authorization: Bearer abc.DEF-123_x~y+z/w=",
      b: "bearer minusculas",
      c: "/join?code=ABCD2345&x=1",
      d: "GET /x?token=abc123#frag",
      e: "a=1;token=zzz;b=2",
      f: "intento password=hunter2 fallido",
      g: `bad token ${TOKEN} here`,
      h: ["lista", TOKEN, { k: `v ${TOKEN}` }],
      i: `?access_token=T1&refresh_token=T2&id_token=T3&api_key=K&apikey=K2&secret=S&sig=X&signature=Y&session_id=Z&sessionid=Q&key=Kk&codigo=C&pwd=P&passwd=Pw`,
    });
    expect(r.a).toBe("Authorization: [oculto]");
    expect(r.b).toBe("Bearer [oculto]");
    expect(r.c).toBe("/join?code=[oculto]&x=1");
    expect(r.d).toBe("GET /x?token=[oculto]#frag");
    expect(r.e).toBe("a=1;token=[oculto];b=2");
    expect(limpiarCampos({ x: "a=1,token=zzz,b=2" }).x).toBe("a=1,token=[oculto],b=2");
    expect(r.f).toBe("intento password=[oculto] fallido");
    expect(r.g).toBe("bad token [oculto] here");
    expect(r.h).toEqual(["lista", "[oculto]", { k: "v [oculto]" }]);
    const todos = String(r.i);
    for (const v of ["T1", "T2", "T3", "=K&", "K2", "=S&", "=X&", "=Y&", "=Z&", "=Q&", "=Kk", "=C&", "=P&", "=Pw"]) expect(todos).not.toContain(v);
    expect(todos.match(/\[oculto\]/g)).toHaveLength(14);
  });

  it("reconoce nombres con prefijo, separadores y formatos habituales (user_token=, key = x, Bearer: x, JSON, %3D, Basic, JWT)", () => {
    const entradas: [string, string][] = [
      ["invite_code=ABC user_token=abc x-token=abc ?auth_token=abc&x=1 client_secret=abc", "invite_code=[oculto] user_token=[oculto] x-token=[oculto] ?auth_token=[oculto]&x=1 client_secret=[oculto]"],
      ["?invite=XYZ12345&otp=123456&pin=1234&auth=abc", "?invite=[oculto]&otp=[oculto]&pin=[oculto]&auth=[oculto]"],
      ["key = abc  bearer=abc  Bearer: abc.def.ghi  password: hunter2", "key = [oculto]  bearer=[oculto]  Bearer: [oculto]  password: [oculto]"],
      ['{"token":"abc123","x":1,"code":"ABCD1234","user":{"api_key":"k","n":5}}', '{"token":"[oculto]","x":1,"code":"[oculto]","user":{"api_key":"[oculto]","n":5}}'],
      ['{"mensaje":"hola \\"token\\"","token": "con \\"comillas\\" y más","fin":true}', '{"mensaje":"hola \\"token\\"","token":"[oculto]","fin":true}'], // un JSON entero se analiza y sale compacto
      ["%3Fcode%3DABCD1234", "%3Fcode%3D[oculto]"],
      ["Authorization: Basic dXNlcjpwYXNz", "Authorization: [oculto]"],
      ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_GHI", OCULTO],
    ];
    for (const [entrada, esperado] of entradas) expect([entrada, limpiarCampos({ x: entrada }).x]).toEqual([entrada, esperado]);
  });

  it("bordes de los formatos: %3d en minúscula, sufijos, espacios y valores sin comillas en JSON, claves en mayúsculas y JWT", () => {
    const entradas: [string, string][] = [
      ["%3Fcode%3dABCD1234", "%3Fcode%3d[oculto]"],
      ['x {"tokens":"abc","api_keys":"k"}', 'x {"tokens":"[oculto]","api_keys":"[oculto]"}'], // sufijo en la clave
      ['x {"user_token":"abc","mi_api_key":"k"}', 'x {"user_token":"[oculto]","mi_api_key":"[oculto]"}'], // prefijo en la clave
      ['x {"token" : "abc","x":1}', 'x {"token" : "[oculto]","x":1}'], // dentro de un texto: espacios antes y después de los dos puntos
      ['{"token" : "abc","x":1}', '{"token":"[oculto]","x":1}'], // un JSON entero se analiza y sale compacto
      ['x {"otp":123456,"n":1}', 'x {"otp":"[oculto]","n":1}'], // sin comillas: corta en la coma
      ['x {"pin":1234}', 'x {"pin":"[oculto]"}'], // y en la llave
      ['x ["pin":5]', 'x ["pin":"[oculto]"]'], // y en el corchete
      ['x {"TOKEN":"abc","Code":"X"}', 'x {"TOKEN":"[oculto]","Code":"[oculto]"}'], // mayúsculas
      ['{"TOKEN":"abc","Code":"X"}', '{"TOKEN":"[oculto]","Code":"[oculto]"}'], // (y como JSON entero)
      ["eyJx.y.z", "eyJx.y.z"], // demasiado corto para ser un JWT
      ["eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.", OCULTO], // sin firma (alg none)
    ];
    for (const [entrada, esperado] of entradas) expect([entrada, limpiarCampos({ x: entrada }).x]).toEqual([entrada, esperado]);
  });

  it("oculta un valor entre comillas, con esquemas de autorización (Token, Digest), cookies y el usuario y la clave de una URL", () => {
    const entradas: [string, string][] = [
      ['token="SECRETO1" y mas', "token=[oculto] y mas"],
      ['password="abc def"', "password=[oculto]"],
      ["key='abc'", "key=[oculto]"],
      ['code="ABC123"', "code=[oculto]"],
      ["Authorization: Token SECRETO4", "Authorization: [oculto]"],
      ["Authorization: Negotiate abc123 y mas", "Authorization: [oculto]"],
      ['token="a\nb" resto', "token=[oculto] resto"], // un valor entre comillas puede tener saltos de línea
      ["key='a\nb' resto", "key=[oculto] resto"],
      ["HTTPS://user:SECRETO@host/x", "HTTPS://user:[oculto]@host/x"], // esquema en mayúsculas
      [`${"a".repeat(30)}://u:SECRETO@h`, `${"a".repeat(30)}://u:[oculto]@h`], // y con un nombre de esquema largo
      ["ver ://u:SECRETO@h", "ver ://u:[oculto]@h"], // y sin esquema
      ["x://a:b:c@h", "x://a:[oculto]@h"], // la clave puede llevar dos puntos: no se filtra ni una parte
      ["user:SECRETO@host sin esquema", "user:SECRETO@host sin esquema"], // sin :// no es una URL
      ["https://user:@host/x", "https://user:@host/x"], // clave vacía
      ["Cookie: sid=SECRETO5; other=1", "Cookie: [oculto]"],
      ["Set-Cookie: sid=x; Path=/", "Set-Cookie: [oculto]"],
      ["antes\nCookie: s=1\ndespues", "antes\nCookie: [oculto]\ndespues"],
      ["https://user:SECRETO7@host/x", "https://user:[oculto]@host/x"],
      ["postgres://u:SECRETO22@h/db y mas", "postgres://u:[oculto]@h/db y mas"],
      ["sin clave: https://host/x y ftp://u@h", "sin clave: https://host/x y ftp://u@h"],
    ];
    for (const [entrada, esperado] of entradas) expect([entrada, limpiarCampos({ x: entrada }).x]).toEqual([entrada, esperado]);
  });

  it("valores compuestos o con comillas simples en un JSON dentro de un texto", () => {
    const entradas: [string, string][] = [
      ['x {"token":["a","SECRETO10"],"ok":1}', 'x {"token":"[oculto]","ok":1}'],
      ['x {"token":{"a":"SECRETO11"},"ok":1}', 'x {"token":"[oculto]","ok":1}'],
      ["x {'token':'SECRETO12','ok':1}", `x {'token':"[oculto]",'ok':1}`],
      ["x {'pin':1234}", `x {'pin':"[oculto]"}`],
    ];
    for (const [entrada, esperado] of entradas) expect([entrada, limpiarCampos({ x: entrada }).x]).toEqual([entrada, esperado]);
  });

  it("un texto que es todo un JSON se analiza de verdad: valores compuestos y anidados se ocultan por el nombre de su clave", () => {
    const entradas: [string, string][] = [
      ['{"token":["a","SECRETO10"],"ok":1}', '{"token":"[oculto]","ok":1}'],
      ['{"a":{"password":"x","b":"Bearer abc"}}', '{"a":{"password":"[oculto]","b":"Bearer [oculto]"}}'],
      ['[{"otp":1},{"n":2}]', '[{"otp":"[oculto]"},{"n":2}]'],
      ['[{"otp": 1}, {"n": 2}]', '[{"otp":"[oculto]"},{"n":2}]'], // un array entero también se analiza y sale compacto
      ['   {"a": 1, "token": "x"}', '{"a":1,"token":"[oculto]"}'], // con espacios al inicio
      ["{no es json token=abc", "{no es json token=[oculto]"],
      ['{"a":1,}', '{"a":1,}'], // JSON inválido: sigue con las formas
    ];
    for (const [entrada, esperado] of entradas) expect([entrada, limpiarCampos({ x: entrada }).x]).toEqual([entrada, esperado]);
    const mediano = `{"a": 1, "pad": "${"x".repeat(500)}", "token": "t"}`;
    expect(String(limpiarCampos({ x: mediano }).x)).toContain('"a":1,"pad"'); // a los 500 caracteres sí se analiza (sale compacto)
    const casiTope = `{"a": 1, "pad": "${"x".repeat(19950)}"}`; // 19.977 caracteres: dentro del tope
    expect(casiTope.length).toBeLessThanOrEqual(20000);
    expect(String(limpiarCampos({ x: casiTope }).x)).toContain('"a":1,"pad"');
    const largo = `{"a": 1, "pad": "${"x".repeat(20000)}", "token": "t"}`;
    const salida = String(limpiarCampos({ x: largo }).x);
    expect(salida).toContain('"a": 1,'); // pasado el tope no se analiza: se conserva el espaciado original (y se corta)
    expect(salida.length).toBeLessThan(1100);
  });

  it("valores entre comillas con comillas escapadas, largos o sin cerrar, Authorization hasta el fin de línea, pass y saltos alrededor del igual", () => {
    const entradas: [string, string][] = [
      ['password="ab\\"cd SECRETO1" fin', "password=[oculto] fin"],
      ["password='it\\'s SECRETO1' fin", "password=[oculto] fin"],
      [`password="${"x".repeat(250)}" host=h`, "password=[oculto]"], // más de 200 caracteres: oculta hasta el fin de línea
      ['password="ab cd SECRETO1', "password=[oculto]"], // sin cerrar
      ['token: "sin cerrar SECRETO and more\nsigue', "token: [oculto]\nsigue"], // hasta el fin de línea
      ["token='sin cerrar SECRETO", "token=[oculto]"],
      ['Authorization: Digest username="u", realm="r", response="SECRETO1"', "Authorization: [oculto]"],
      ["Proxy-Authorization: Basic abc", "Proxy-Authorization: [oculto]"],
      ["a\nAuthorization: x y z\nb", "a\nAuthorization: [oculto]\nb"],
      ["pass: hunter2", "pass: [oculto]"],
      ["tokens=abc&keys=x&passwords=y&api_keys=z", "tokens=[oculto]&keys=[oculto]&passwords=[oculto]&api_keys=[oculto]"], // sufijos
      ["Authorization: Basic abc; extra SECRETO", "Authorization: [oculto]"], // hasta el fin de línea, con punto y coma en medio
      ["secret\n=\nSECRETO", "secret\n=\n[oculto]"],
      ["key  \t=  abc", "key  \t=  [oculto]"],
    ];
    for (const [entrada, esperado] of entradas) expect([entrada, limpiarCampos({ x: entrada }).x]).toEqual([entrada, esperado]);
  });

  it("un texto largo con -eyJ repetido no se cuelga (la expresión del JWT no retrocede de forma cuadrática)", () => {
    const t0 = Date.now();
    limpiarCampos({ m: "-eyJ".repeat(100_000) });
    limpiarCampos({ m: "eyJ" + "a".repeat(400_000) });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(limpiarCampos({ a: "x -eyJabcdef.ghi.jkl" }).a).toBe("x -eyJabcdef.ghi.jkl"); // pegado a un guion no es un JWT
    expect(limpiarCampos({ a: "x eyJabcdef.ghi.jkl" }).a).toBe("x [oculto]");
  });

  it("las claves de objeto largas se cortan como los valores", () => {
    const r = limpiarCampos({ ["k".repeat(1_000_000)]: 1 });
    const clave = Object.keys(r)[0]!;
    expect(clave.length).toBeLessThan(1100);
    expect(clave).toContain("más]");
  });

  it("no toca lo legítimo: fechas, UUID, rutas, mensajes normales y trazas de pila", () => {
    const campos = {
      a: "fecha 2026-11-23T18:28:02.931Z uuid 0193b4c2-7e1f-7abc-8def-0123456789ab ruta /v1/trips/x/changes",
      b: "error: no se pudo abrir la base",
      c: "at Object.<anonymous> (file:///repo/server/src/x.ts:11:40)",
      d: "a".repeat(64),
    };
    expect(limpiarCampos(campos)).toEqual(campos);
  });

  it("bordes de la redacción de textos: bearers, parámetro al inicio, comillas, valor vacío y mayúsculas", () => {
    expect(limpiarCampos({ a: "los bearers de la noticia" }).a).toBe("los bearers de la noticia"); // Bearer exige un espacio y un valor
    expect(limpiarCampos({ a: "xbearer abc" }).a).toBe("xbearer abc"); // y empezar la palabra
    expect(limpiarCampos({ a: "token=abc" }).a).toBe("token=[oculto]"); // al inicio del texto
    expect(limpiarCampos({ a: 'url "?token=abc" fin' }).a).toBe('url "?token=[oculto]" fin'); // la comilla cierra el valor
    expect(limpiarCampos({ a: "url '?token=abc' fin" }).a).toBe("url '?token=[oculto]' fin");
    expect(limpiarCampos({ a: "token=&x=1" }).a).toBe("token=&x=1"); // un valor vacío no se toca
    expect(limpiarCampos({ a: "?TOKEN=abc&Code=X&PASSWORD=p" }).a).toBe("?TOKEN=[oculto]&Code=[oculto]&PASSWORD=[oculto]"); // sin importar mayúsculas
  });

  it("un token de 42 o de 44 caracteres, un UUID y un nombre de evento no se ocultan; decode=5 sí (la palabra va dentro del nombre: se oculta de más)", () => {
    const campos = { c: TOKEN.slice(1), d: `${TOKEN}Z`, e: "0193b4c2-7e1f-7abc-8def-0123456789ab", f: "ops_recibidas" };
    expect(limpiarCampos(campos)).toEqual(campos);
    expect(limpiarCampos({ a: "decode=5&barcode=1" }).a).toBe("decode=[oculto]&barcode=[oculto]");
  });

  it("las claves de objeto también se limpian por su forma (una etiqueta de métrica con un token o un código)", () => {
    const r = limpiarCampos({ [`http{ruta=/join/${TOKEN}}`]: 1, "x?code=ABCD1234": 2, ok: 3 });
    expect(Object.keys(r).sort()).toEqual(["http{ruta=/join/[oculto]}", "ok", "x?code=[oculto]"]);
  });

  it("un token pegado a otros caracteres de su alfabeto no es un token aparte, pero sí cuando lo separa un signo", () => {
    expect(limpiarCampos({ a: `x${TOKEN}` }).a).toBe(`x${TOKEN}`); // 44 seguidos
    expect(limpiarCampos({ a: `(${TOKEN})` }).a).toBe("([oculto])");
    expect(limpiarCampos({ a: `${TOKEN}.${TOKEN}` }).a).toBe("[oculto].[oculto]");
    expect(limpiarCampos({ a: `id:${TOKEN}` }).a).toBe("id:[oculto]");
  });

  it("el mensaje y la pila de un error también se limpian, y no se copian sus otras propiedades", () => {
    const err = Object.assign(new Error(`bad token ${TOKEN}`), { token: "OTRO-SECRETO", headers: { a: 1 }, cause: new Error("causa-secreta") });
    const r = limpiarCampos({ err }) as { err: Record<string, unknown> };
    expect(r.err.message).toBe("bad token [oculto]");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain("OTRO-SECRETO");
    expect(Object.keys(r.err).sort()).toEqual(["cause", "message", "stack", "type"]); // la causa se conserva, también limpia
    expect(r.err.cause).toMatchObject({ type: "Error", message: "causa-secreta" });
  });

  it("los datos binarios y las colecciones se resumen sin mostrar su contenido", () => {
    const r = limpiarCampos({
      buf: Buffer.from("SECRETO"),
      u8: new Uint8Array([1, 2, 3]),
      ab: new ArrayBuffer(16),
      dv: new DataView(new ArrayBuffer(4)),
      mapa: new Map<string, unknown>([["token", "SECRETO"], ["b", 2]]),
      conjunto: new Set(["SECRETO", "x", "y"]),
      vacio: new Map(),
    });
    expect(r).toEqual({ buf: "[binario 7 bytes]", u8: "[binario 3 bytes]", ab: "[binario 16 bytes]", dv: "[binario 4 bytes]", mapa: "[Map 2]", conjunto: "[Set 3]", vacio: "[Map 0]" });
  });

  it("no se deja envenenar por una clave __proto__ (que JSON.parse crea como propia)", () => {
    const hostil = JSON.parse('{"__proto__":{"inyectado":true},"normal":1}') as Record<string, unknown>;
    const r = limpiarCampos(hostil);
    expect(({} as Record<string, unknown>).inyectado).toBeUndefined();
    expect(Object.getPrototypeOf(r)).toBeNull();
    expect(JSON.stringify(r)).toContain('"normal":1');
  });

  it("lo que no son campos da un objeto vacío", () => {
    for (const x of [undefined, null, "texto", 7, true] as unknown[]) expect(limpiarCampos(x as undefined)).toEqual({});
  });
});

describe("limpiarError", () => {
  it("devuelve type, message y stack, y el código solo si es un identificador corto", () => {
    expect(limpiarError(new RangeError("falló"))).toMatchObject({ type: "RangeError", message: "falló" });
    expect(Object.keys(limpiarError(new Error("x"))).sort()).toEqual(["message", "stack", "type"]);
    const conCodigo = (codigo: unknown) => limpiarError(Object.assign(new Error("x"), { code: codigo })).code;
    expect(conCodigo("ECONNRESET")).toBe("ECONNRESET");
    expect(conCodigo("FST_ERR_CTP_INVALID_MEDIA_TYPE")).toBe("FST_ERR_CTP_INVALID_MEDIA_TYPE");
    expect(conCodigo("a".repeat(64))).toBe("a".repeat(64));
    expect(conCodigo("ERR.SUB")).toBe("ERR.SUB");
    expect(conCodigo("ERR-SUB")).toBe("ERR-SUB");
    expect(conCodigo(TOKEN)).toBe(OCULTO); // un código con forma de token también se oculta
    expect(conCodigo("a".repeat(65))).toBeUndefined();
    for (const malo of ["con espacios", "ñandú", "", 42, null, undefined, {}]) expect([malo, conCodigo(malo)]).toEqual([malo, undefined]);
  });

  it("conserva la causa y los errores de un AggregateError, limpios, y no se cuelga con causas circulares ni cadenas largas", () => {
    const agg = limpiarError(new AggregateError([new Error("token=zz"), new RangeError("b")], "varios", { cause: new Error(`Bearer ${TOKEN}`) })) as { errors: { message: string }[]; cause: { message: string } };
    expect(agg.errors.map((e) => e.message)).toEqual(["token=[oculto]", "b"]);
    expect(agg.cause.message).toBe("Bearer [oculto]");
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    const ciclo = limpiarError(a) as { cause: { cause: unknown } };
    expect(ciclo.cause.cause).toBe("[circular]"); // aparece al volver a `a`, no un nivel después
    let cadena = new Error("fin");
    for (let i = 0; i < 20; i++) cadena = new Error(`n${i}`, { cause: cadena });
    expect(JSON.stringify(limpiarError(cadena))).toContain("[demasiado profundo]");
    expect(limpiarError(new Error("sin causa"))).not.toHaveProperty("cause");
  });

  it("un error cuyo mensaje no se puede leer no tumba el log", () => {
    const hostil = Object.create(Error.prototype, { message: { get: () => { throw new Error("no se puede"); } } }) as Error;
    expect(limpiarError(hostil)).toEqual({ type: "Error", message: "[ilegible]" });
  });
});

describe("rutaSinConsulta", () => {
  it("quita los parámetros y el fragmento, y no inventa nada si no es texto", () => {
    expect(rutaSinConsulta("/join?code=ABCD2345")).toBe("/join");
    expect(rutaSinConsulta("/v1/trips/x/changes?after=3&limit=200")).toBe("/v1/trips/x/changes");
    expect(rutaSinConsulta("/a#frag")).toBe("/a");
    expect(rutaSinConsulta("/a?b#c")).toBe("/a");
    expect(rutaSinConsulta("/a#c?d")).toBe("/a");
    expect(rutaSinConsulta("/sin/nada")).toBe("/sin/nada");
    expect(rutaSinConsulta("?solo=consulta")).toBe("");
    for (const x of [undefined, null, 5, {}, ["/a?b"]]) expect(rutaSinConsulta(x)).toBe("");
  });
});

describe("abreviarId", () => {
  it("deja los primeros 8 caracteres y no inventa nada si no es texto", () => {
    expect(abreviarId("0193b4c2-7e1f-7abc-8def-0123456789ab")).toBe("0193b4c2");
    expect(abreviarId("abc")).toBe("abc");
    for (const x of [undefined, null, 7, {}, ["abcdefghij"]]) expect(abreviarId(x)).toBe("");
  });
});

describe("leerNivel (LOG_LEVEL)", () => {
  it("sin valor o vacío usa info", () => {
    for (const x of [undefined, "", "   "]) expect(leerNivel(x)).toBe("info");
  });

  it("acepta los niveles sin importar mayúsculas ni espacios", () => {
    expect(leerNivel("debug")).toBe("debug");
    expect(leerNivel(" WARN ")).toBe("warn");
    expect(leerNivel("Error")).toBe("error");
    expect(leerNivel("silent")).toBe("silent");
  });

  it("un valor que no es un nivel falla al arrancar", () => {
    for (const x of ["verbose", "trace", "fatal", "1", "info,debug"]) expect(() => leerNivel(x)).toThrow(RangeError);
  });
});

describe("registroNulo", () => {
  it("no escribe nada, no lanza y su hijo es el mismo", () => {
    registroNulo.info("x", { a: 1 });
    registroNulo.error("x");
    expect(registroNulo.hijo({ a: 1 })).toBe(registroNulo);
  });
});
