import { describe, expect, it } from "vitest";
import { ALFABETO_CODIGO, claveDeRed, generarCodigo, generarToken, huellaDeCodigo, huellaDeIp, huellaDeToken, leerPepper, normalizarCodigo, uuidV7, type Aleatorio } from "../../src/dominio/credenciales.js";

// Los valores esperados los calculó otra herramienta (hashlib y hmac de Python), no este código.
const PEPPER_TEXTO = "0123456789abcdef".repeat(4);
const OTRO_PEPPER_TEXTO = "fedcba9876543210".repeat(4);
const pepper = leerPepper(PEPPER_TEXTO);
const otroPepper = leerPepper(OTRO_PEPPER_TEXTO);

/** Una fuente de azar que devuelve, en orden, los bytes dados (y repite el último si se acaban). */
function guion(...bytes: number[]): Aleatorio {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => bytes[Math.min(i++, bytes.length - 1)] as number);
}

/** Generador pseudoaleatorio con semilla (solo para pruebas de distribución). */
function semilla(valor: number): Aleatorio {
  let s = valor >>> 0;
  return (n) => Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

describe("huellas", () => {
  it("la huella del token es el SHA-256 del texto en hexadecimal minúscula", () => {
    expect(huellaDeToken("token-de-prueba")).toBe("6f01606f61af728b4309e0e78f0c9a7c35f76c1e02b3c892f245a9cfc9bc8314");
    expect(huellaDeToken("token-de-prueba")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("el token debe ser un texto no vacío", () => {
    for (const malo of ["", 5, null, undefined, {}]) expect(() => huellaDeToken(malo as string), String(malo)).toThrow(RangeError);
  });
  it("la huella del código es un HMAC-SHA256 con el pepper y depende del pepper", () => {
    expect(huellaDeCodigo("ABCD2345", pepper)).toBe("cb9239859a7b5d5ee37452fb105e5a1750cc7971ef6d413a12abfe2a59afcf24");
    expect(huellaDeCodigo("ABCD2345", otroPepper)).toBe("569679b2e51e3365895122c1d759427fd36f404626c415b94798121ae46df335");
  });
  it("el código debe llegar ya normalizado", () => {
    for (const malo of ["abcd2345", "ABCD-2345", "ABCD234", "ABCD23456", "ABCD2340", "", 5 as unknown as string]) {
      expect(() => huellaDeCodigo(malo, pepper), String(malo)).toThrow(RangeError);
    }
  });
  it("la huella de la IP es un HMAC-SHA256 con el pepper sobre su clave de red", () => {
    expect(huellaDeIp("203.0.113.7", pepper)).toBe("33354f783f45dabcbc8cded9f21870cc804ad6463f51aa77e5aa9a62e7aacc60");
    // una IPv6 se reduce a su /64: el HMAC es el de "ip:2001:0db8:0000:0000/64" (calculado con Python)
    expect(huellaDeIp("2001:db8::1", pepper)).toBe("9eba5ee5542b46a7a551f119b086e2b589cab07e5fc99161ddbdcab5bdfbefd3");
  });
  it("cada uso tiene su dominio: la misma clave da huellas distintas como IP y como código", () => {
    // HMAC de "codigo:203.0.113.7" (calculado con Python): no coincide con el de "ip:203.0.113.7"
    expect(huellaDeIp("203.0.113.7", pepper)).not.toBe("57bef42d7681378619d9a5c9f2819a3c18ee2838dc998fbddc3ae6cb010d962c");
    expect(huellaDeCodigo("ABCD2345", pepper)).not.toBe(huellaDeToken("ABCD2345"));
  });
  it("el pepper debe ser un Uint8Array de al menos 32 bytes: una clave vacía no produce huellas en silencio", () => {
    for (const malo of [new Uint8Array(0), new Uint8Array(31), "0123456789abcdef".repeat(4), null, undefined, [1, 2, 3], 5]) {
      expect(() => huellaDeCodigo("ABCD2345", malo as unknown as Uint8Array), `codigo ${String(malo)}`).toThrow(/pepper/);
      expect(() => huellaDeIp("203.0.113.7", malo as unknown as Uint8Array), `ip ${String(malo)}`).toThrow(/pepper/);
    }
    expect(huellaDeCodigo("ABCD2345", new Uint8Array(32).fill(7))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("clave de red de una IP (para limitar intentos)", () => {
  // Los valores esperados los calculó el módulo `ipaddress` de Python.
  const casos: [string, string][] = [
    ["203.0.113.7", "203.0.113.7"],
    ["255.255.255.255", "255.255.255.255"],
    ["0.0.0.0", "0.0.0.0"],
    ["  203.0.113.7 ", "203.0.113.7"],
    ["::1", "0000:0000:0000:0000/64"],
    ["0:0:0:0:0:0:0:1", "0000:0000:0000:0000/64"],
    ["::", "0000:0000:0000:0000/64"],
    ["2001:db8::1", "2001:0db8:0000:0000/64"],
    ["2001:DB8::1", "2001:0db8:0000:0000/64"],
    ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:0db8:0000:0000/64"],
    ["2001:db8:0:0:1::5", "2001:0db8:0000:0000/64"],
    ["2001:db8:0:1::1", "2001:0db8:0000:0001/64"],
    ["fe80::1%eth0", "fe80:0000:0000:0000/64"],
    ["::1%", "0000:0000:0000:0000/64"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::ffff:cb00:7107", "203.0.113.7"],
    ["::FFFF:203.0.113.7", "203.0.113.7"],
    ["64:ff9b::203.0.113.7", "0064:ff9b:0000:0000/64"],
    ["2001:db8::203.0.113.7", "2001:0db8:0000:0000/64"],
    ["1:2:3:4:5:6:7:8", "0001:0002:0003:0004/64"],
    ["1:2:3:4:5:6:1.2.3.4", "0001:0002:0003:0004/64"],
    // IPv4 mapeada con octetos altos: cada uno de los cuatro sale de su propio byte
    ["::ffff:203.200.150.250", "203.200.150.250"],
    ["::ffff:cbc8:96fa", "203.200.150.250"],
    ["::ffff:255.255.255.255", "255.255.255.255"],
    ["::ffff:128.128.128.128", "128.128.128.128"],
    ["::ffff:0:0", "0.0.0.0"],
    ["0:0:0:0:0:ffff::", "0.0.0.0"],
    // con el marcador ffff pero con algún grupo anterior distinto de cero NO es una IPv4 mapeada
    ["0:0:0:0:1:ffff:cb00:7107", "0000:0000:0000:0000/64"],
    ["1:0:0:0:0:ffff:cb00:7107", "0001:0000:0000:0000/64"],
    ["0:0:1:0:0:ffff:cb00:7107", "0000:0000:0001:0000/64"],
    ["0:0:0:1:0:ffff:cb00:7107", "0000:0000:0000:0001/64"],
    // "::" al principio, en el medio y al final
    ["1::", "0001:0000:0000:0000/64"],
    ["1:2:3:4:5:6:7::", "0001:0002:0003:0004/64"],
    ["::2:3:4:5:6:7:8", "0000:0002:0003:0004/64"],
  ];
  for (const [entrada, clave] of casos) it(`${JSON.stringify(entrada)} → ${clave}`, () => expect(claveDeRed(entrada)).toBe(clave));

  it("lo que no es una IP se rechaza", () => {
    for (const malo of ["", "abc", "1.2.3", "1.2.3.4.5", "256.1.1.1", "2001:db8::g", ":::", "1:2:3:4:5:6:7:8:9", "2001:db8:::1", "1.2.3.4/24", "2001:db8::/64", "[::1]", "1:2:3:4:5:6:7"]) {
      expect(() => claveDeRed(malo), JSON.stringify(malo)).toThrow(RangeError);
    }
    for (const malo of [5, null, undefined, {}, []]) expect(() => claveDeRed(malo as unknown as string), String(malo)).toThrow(RangeError);
  });

  it("las formas equivalentes de una misma dirección comparten huella: no se esquiva el límite escribiéndola distinto", () => {
    const igual = ["2001:db8::1", "2001:DB8::1", "2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8:0:0:0:0:0:1", " 2001:db8::1 "];
    expect(new Set(igual.map((ip) => huellaDeIp(ip, pepper))).size).toBe(1);
  });
  it("las direcciones de un mismo /64 comparten huella: un hogar IPv6 no multiplica sus intentos", () => {
    const mismoHogar = ["2001:db8::1", "2001:db8::2", "2001:db8:0:0:ffff:ffff:ffff:ffff", "2001:db8:0:0:1::5"];
    expect(new Set(mismoHogar.map((ip) => huellaDeIp(ip, pepper))).size).toBe(1);
    expect(huellaDeIp("2001:db8:0:1::1", pepper)).not.toBe(huellaDeIp("2001:db8::1", pepper)); // otro /64
  });
  it("una IPv4 escrita como IPv6 mapeada es la misma IPv4", () => {
    expect(huellaDeIp("::ffff:203.0.113.7", pepper)).toBe(huellaDeIp("203.0.113.7", pepper));
    expect(huellaDeIp("::ffff:cb00:7107", pepper)).toBe(huellaDeIp("203.0.113.7", pepper));
    expect(huellaDeIp("203.0.113.8", pepper)).not.toBe(huellaDeIp("203.0.113.7", pepper));
  });
});

describe("pepper", () => {
  it("un espacio o un salto de línea en el medio se conserva: solo se recortan los de alrededor", () => {
    expect(leerPepper(`${"a".repeat(32)} ${"b".repeat(32)}`).length).toBe(65);
    expect(leerPepper(`${"a".repeat(32)}\r\n${"b".repeat(32)}`).length).toBe(66);
    expect(Buffer.from(leerPepper(`\ufeff${"a".repeat(32)}`)).toString("utf8")).toBe("a".repeat(32)); // el BOM de alrededor se recorta
  });
  it("se lee del contenido del archivo sin espacios ni saltos de línea alrededor", () => {
    const limpio = leerPepper(PEPPER_TEXTO);
    expect(Buffer.from(limpio).toString("utf8")).toBe(PEPPER_TEXTO);
    expect(Buffer.from(leerPepper(`${PEPPER_TEXTO}\n`)).toString("utf8")).toBe(PEPPER_TEXTO);
    expect(Buffer.from(leerPepper(`  \r\n${PEPPER_TEXTO}\r\n `)).toString("utf8")).toBe(PEPPER_TEXTO);
    expect(huellaDeCodigo("ABCD2345", leerPepper(`${PEPPER_TEXTO}\n`))).toBe(huellaDeCodigo("ABCD2345", pepper));
  });
  it("debe tener al menos 32 bytes", () => {
    expect(() => leerPepper("a".repeat(31))).toThrow(/32 bytes/);
    expect(() => leerPepper("")).toThrow(/32 bytes/);
    expect(() => leerPepper(`${"a".repeat(31)}\n`)).toThrow(/32 bytes/);
    expect(leerPepper("a".repeat(32)).length).toBe(32);
    expect(() => leerPepper(5 as unknown as string)).toThrow(RangeError);
  });
  it("cuenta bytes y no caracteres", () => {
    expect(leerPepper("é".repeat(16)).length).toBe(32); // 16 caracteres, 32 bytes en UTF-8
  });
});

describe("token", () => {
  it("son 256 bits en base64url, sin relleno, y usa todos los bytes que da la fuente", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 8);
    let pedidos = 0;
    const token = generarToken((n) => { pedidos = n; return bytes; });
    expect(pedidos).toBe(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toEqual(Buffer.from(bytes));
  });
  it("exige exactamente 32 bytes de la fuente de azar, y que sea un Uint8Array", () => {
    expect(() => generarToken(() => new Uint8Array(31))).toThrow(RangeError);
    expect(() => generarToken(() => new Uint8Array(33))).toThrow(RangeError);
    expect(() => generarToken(() => Array(32).fill(1) as unknown as Uint8Array)).toThrow(/Uint8Array/);
    expect(() => generarToken(() => ({ length: 32 }) as unknown as Uint8Array)).toThrow(/Uint8Array/);
  });
  it("con la fuente del sistema no se repite y tiene la forma", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = generarToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      vistos.add(t);
    }
    expect(vistos.size).toBe(500);
  });
});

describe("código de invitación", () => {
  it("el alfabeto tiene 31 símbolos y ninguno ambiguo", () => {
    expect(ALFABETO_CODIGO).toHaveLength(31);
    expect(new Set(ALFABETO_CODIGO).size).toBe(31);
    for (const c of "01ILO") expect(ALFABETO_CODIGO).not.toContain(c);
    expect(ALFABETO_CODIGO).toMatch(/^[2-9A-Z]+$/);
  });
  it("cada byte menor que 248 elige el símbolo de su resto módulo 31", () => {
    expect(generarCodigo(guion(0, 1, 2, 3, 4, 5, 6, 7))).toBe("23456789"); // primeros 8 símbolos
    // valores calculados aparte (Python): resto módulo 31 de cada byte y su símbolo
    expect(generarCodigo(guion(30, 31, 61, 62, 247, 93, 124, 155))).toBe("Z2Z2Z222");
    expect(generarCodigo(guion(1, 33, 65, 17, 100, 200, 5, 29))).toBe("345K9G7Y");
    expect(generarCodigo(guion(10, 20, 30, 40, 50, 60, 70, 80))).toBe("CPZBNYAM");
    expect(generarCodigo(guion(247, 0, 31, 62, 93, 124, 155, 186))).toBe("Z2222222");
  });
  it("los bytes de 248 en adelante se descartan (sin sesgo) y se sigue con los que vienen", () => {
    // 248..255 se descartan; los que siguen se usan
    expect(generarCodigo(guion(248, 249, 250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7))).toBe("23456789");
    expect(generarCodigo(guion(0, 255, 1, 255, 2, 255, 3, 255, 4, 255, 5, 255, 6, 255, 7, 255))).toBe("23456789");
    expect(generarCodigo(guion(247, 247, 247, 247, 247, 247, 247, 247))).toBe("ZZZZZZZZ"); // 247 = 7*31 + 30: aún cae dentro
  });
  it("exige 16 bytes por sorteo y un Uint8Array: un doble de prueba mal escrito no produce un código con \"undefined\"", () => {
    expect(() => generarCodigo(() => [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as unknown as Uint8Array)).toThrow(/Uint8Array/);
    expect(() => generarCodigo(() => new Uint8Array(15))).toThrow(RangeError);
    expect(() => generarCodigo(() => new Uint8Array(17))).toThrow(RangeError);
  });
  it("si la fuente da solo bytes descartados falla en vez de colgarse", () => {
    expect(() => generarCodigo(guion(255))).toThrow(/bytes suficientes/);
  });
  it("junta varios sorteos si en uno no alcanzan los bytes aceptados", () => {
    const secuencia = [...Array(15).fill(255), 0, ...Array(15).fill(255), 1, ...Array(16).fill(2)];
    expect(generarCodigo(guion(...secuencia))).toBe("23" + "4".repeat(6));
  });
  it("siempre tiene 8 símbolos del alfabeto y se normaliza a sí mismo", () => {
    for (let i = 0; i < 200; i++) {
      const c = generarCodigo();
      expect(c).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
      expect(normalizarCodigo(c)).toBe(c);
    }
  });
  it("todos los símbolos salen con frecuencia pareja (sin sesgo apreciable)", () => {
    const cuenta = new Map<string, number>();
    const azar = semilla(7);
    const CODIGOS = 20_000;
    for (let i = 0; i < CODIGOS; i++) for (const c of generarCodigo(azar)) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
    const total = CODIGOS * 8;
    const esperado = total / 31;
    const sigma = Math.sqrt(total * (1 / 31) * (30 / 31));
    expect(cuenta.size).toBe(31);
    for (const [c, n] of cuenta) expect(Math.abs(n - esperado), c).toBeLessThan(5 * sigma);
  });
});

describe("normalizar lo que escribe una persona", () => {
  it("quita también los separadores que se cuelan al copiar de un chat: espacio duro, raya, guion largo, signo menos y espacios de otros alfabetos", () => {
    const esperado = "ABCD2345";
    for (const [nombre, sep] of [["espacio duro", "\u00a0"], ["guion largo (U+2013)", "\u2013"], ["raya (U+2014)", "\u2014"], ["signo menos", "\u2212"], ["guion de unión (U+2010)", "\u2010"], ["espacio de cifra", "\u2007"], ["espacio fino estrecho", "\u202f"], ["espacio ideográfico", "\u3000"]] as const) {
      expect(normalizarCodigo(`ABCD${sep}2345`), nombre).toBe(esperado);
      expect(normalizarCodigo(`${sep}abcd${sep}2345${sep}`), nombre).toBe(esperado);
    }
  });
  it("también se quitan tabuladores, saltos de línea, el BOM y los separadores de línea y de párrafo (lo que `\\s` de JavaScript llama espacio)", () => {
    for (const [nombre, sep] of [["tabulador", "\t"], ["salto de línea", "\n"], ["retorno", "\r\n"], ["BOM", "\ufeff"], ["separador de línea U+2028", "\u2028"], ["separador de párrafo U+2029", "\u2029"], ["tabulador vertical", "\v"], ["avance de página", "\f"]] as const) {
      expect(normalizarCodigo(`ABCD${sep}2345`), nombre).toBe("ABCD2345");
      expect(normalizarCodigo(`${sep}ABCD2345${sep}`), nombre).toBe("ABCD2345");
    }
  });
  it("pero un carácter invisible que no es separador (espacio de ancho cero) se rechaza: no se adivina", () => {
    expect(normalizarCodigo("ABCD\u200b2345")).toBeNull();
    expect(normalizarCodigo("ABCD\u2060" + "2345")).toBeNull();
    for (const [nombre, c] of [["guion suave", "\u00ad"], ["siguiente línea U+0085", "\u0085"], ["guion de ancho completo", "\uff0d"], ["guion pequeño U+FE63", "\ufe63"], ["separador mongol", "\u180e"], ["NUL", "\u0000"], ["control ASCII", "\u001f"]] as const) {
      expect(normalizarCodigo(`ABCD${c}2345`), nombre).toBeNull();
    }
  });
  it("acepta minúsculas, espacios y guiones", () => {
    expect(normalizarCodigo("abcd2345")).toBe("ABCD2345");
    expect(normalizarCodigo("ABCD-2345")).toBe("ABCD2345");
    expect(normalizarCodigo(" abcd 2345 ")).toBe("ABCD2345");
    expect(normalizarCodigo("ab-cd 23\t45\n")).toBe("ABCD2345");
  });
  it("rechaza lo que no tiene la forma: largo, símbolos fuera del alfabeto y no texto", () => {
    for (const malo of ["", "ABCD234", "ABCD23456", "ABCD2340", "ABCD2341", "ABCDI345", "ABCDL345", "ABCDO345", "ABCD234!", "--------", "        "]) {
      expect(normalizarCodigo(malo), JSON.stringify(malo)).toBeNull();
    }
    for (const malo of [5, null, undefined, {}, [], true]) expect(normalizarCodigo(malo), String(malo)).toBeNull();
  });
  it("no acepta letras que no sean ASCII, aunque al pasar a mayúsculas parezcan válidas", () => {
    // pasar a mayúsculas convierte una letra en otras (ß en SS, ﬀ en FF, ﬆ en ST): estos darían un código válido de la nada
    expect("ßßßß".toUpperCase()).toBe("SSSSSSSS");
    expect("ﬀﬀﬀﬀ".toUpperCase()).toBe("FFFFFFFF");
    expect("ﬆﬆﬆﬆ".toUpperCase()).toBe("STSTSTST");
    expect(normalizarCodigo("ßßßß")).toBeNull();
    expect(normalizarCodigo("ﬀﬀﬀﬀ")).toBeNull();
    expect(normalizarCodigo("ﬆﬆﬆﬆ")).toBeNull();
    expect(normalizarCodigo("ßßßß2345")).toBeNull();
    expect(normalizarCodigo("ABCD234ß")).toBeNull();
    expect(normalizarCodigo("ａｂｃｄ２３４５")).toBeNull(); // ancho completo
    expect(normalizarCodigo("ABCD2345é")).toBeNull();
    expect(normalizarCodigo("ᴀBCD2345")).toBeNull();
  });
  it("un código que se acaba de generar vuelve igual aunque se escriba con guion o en minúscula", () => {
    const c = generarCodigo();
    expect(normalizarCodigo(`${c.slice(0, 4)}-${c.slice(4)}`.toLowerCase())).toBe(c);
  });
});

describe("UUID v7", () => {
  it("coincide con los valores calculados por otra herramienta", () => {
    expect(uuidV7(0, guion(0))).toBe("00000000-0000-7000-8000-000000000000");
    expect(uuidV7(1802000000000, () => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe("01a38f91-e400-7102-8304-05060708090a");
    expect(uuidV7(2 ** 48 - 1, guion(255))).toBe("ffffffff-ffff-7fff-bfff-ffffffffffff");
    expect(uuidV7(1700000000123, () => Uint8Array.from([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0x9a, 0xbc]))).toBe("018bcfe5-687b-7bcd-af01-234567899abc");
  });
  it("siempre tiene versión 7, variante 10 y la forma que valida el proyecto", () => {
    const patron = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 300; i++) expect(uuidV7(1802000000000 + i)).toMatch(patron);
    expect(uuidV7(5, guion(255))).toMatch(patron);
  });
  it("se ordena por la hora: a mayor hora, mayor texto", () => {
    const azar = semilla(11);
    let anterior = "";
    for (let ms = 1802000000000; ms < 1802000000000 + 300; ms += 7) {
      const u = uuidV7(ms, azar);
      expect(u > anterior, `${u} <= ${anterior}`).toBe(true);
      anterior = u;
    }
  });
  it("la hora debe ser un entero entre 0 y 2^48 - 1", () => {
    for (const malo of [-1, 2 ** 48, 1.5, NaN, Infinity, "5", null, undefined]) expect(() => uuidV7(malo as number), String(malo)).toThrow(/entero entre 0 y 281474976710655/);
  });
  it("exige exactamente 10 bytes de la fuente de azar", () => {
    expect(() => uuidV7(1, () => new Uint8Array(9))).toThrow(RangeError);
    expect(() => uuidV7(1, () => new Uint8Array(11))).toThrow(RangeError);
  });
  it("con la fuente del sistema no se repiten en la misma milésima", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) vistos.add(uuidV7(1802000000000));
    expect(vistos.size).toBe(1000);
  });
});
