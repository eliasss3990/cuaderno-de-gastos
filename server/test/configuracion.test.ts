import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion, leerConfiguracion } from "../src/configuracion.js";

const BASE = { DATA_DIR: "/data", ADJUNTOS_DIR: "/adjuntos", PEPPER_FILE: "/run/secrets/pepper" };
const mensaje = (env: Record<string, string | undefined>): string => {
  try {
    leerConfiguracion(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorDeConfiguracion);
    expect((e as Error).name).toBe("ErrorDeConfiguracion");
    return (e as Error).message;
  }
  return "sin error";
};

describe("leerConfiguracion", () => {
  it("con lo obligatorio usa los valores por defecto: puerto 8094, nivel info y sin versión mínima", () => {
    expect(leerConfiguracion(BASE)).toEqual({ puerto: 8094, dirDatos: "/data", dirAdjuntos: "/adjuntos", archivoPepper: "/run/secrets/pepper", nivelDeLog: "info" });
  });

  it("lee todo lo que se informa", () => {
    const c = leerConfiguracion({ ...BASE, PORT: "9000", LOG_LEVEL: "debug", APP_MIN_VERSION: "0.2.0" });
    expect(c).toEqual({ puerto: 9000, dirDatos: "/data", dirAdjuntos: "/adjuntos", archivoPepper: "/run/secrets/pepper", nivelDeLog: "debug", versionMinima: "0.2.0" });
  });

  it("recorta los espacios de alrededor y trata un valor vacío como ausente en lo opcional", () => {
    const c = leerConfiguracion({ DATA_DIR: "  /data  ", ADJUNTOS_DIR: " /a ", PEPPER_FILE: " /p ", PORT: "  ", LOG_LEVEL: "", APP_MIN_VERSION: "   " });
    expect(c).toEqual({ puerto: 8094, dirDatos: "/data", dirAdjuntos: "/a", archivoPepper: "/p", nivelDeLog: "info" });
    expect(leerConfiguracion({ ...BASE, PORT: " 8095 " }).puerto).toBe(8095);
  });

  it("el puerto debe ser un entero de 1 a 65535", () => {
    for (const bueno of ["1", "80", "8094", "65535"]) expect(leerConfiguracion({ ...BASE, PORT: bueno }).puerto).toBe(Number(bueno));
    for (const malo of ["0", "65536", "-1", "abc", "80x", "8e3", "1.5", "123456", "0x50", "８０", "9".repeat(30)]) {
      expect([malo, mensaje({ ...BASE, PORT: malo })]).toEqual([malo, `configuración inválida: PORT debe ser un número entre 1 y 65535 (llegó "${malo}")`]);
    }
  });

  it("DATA_DIR, ADJUNTOS_DIR y PEPPER_FILE son obligatorios y no pueden estar vacíos", () => {
    expect(mensaje({ ADJUNTOS_DIR: "/a", PEPPER_FILE: "/p" })).toBe("configuración inválida: falta DATA_DIR (la carpeta de los datos)");
    expect(mensaje({ DATA_DIR: "/d", PEPPER_FILE: "/p" })).toBe("configuración inválida: falta ADJUNTOS_DIR (la carpeta de los archivos adjuntos)");
    expect(mensaje({ DATA_DIR: "/d", ADJUNTOS_DIR: "/a" })).toBe("configuración inválida: falta PEPPER_FILE (el archivo con el valor secreto)");
    const vacios = mensaje({ DATA_DIR: "  ", ADJUNTOS_DIR: " ", PEPPER_FILE: "" });
    for (const parte of ["falta DATA_DIR", "falta ADJUNTOS_DIR", "falta PEPPER_FILE"]) expect(vacios).toContain(parte);
  });

  it("LOG_LEVEL debe ser un nivel conocido", () => {
    for (const nivel of ["debug", "info", "warn", "error", "silent", "WARN"]) expect(leerConfiguracion({ ...BASE, LOG_LEVEL: nivel }).nivelDeLog).toBe(nivel.toLowerCase());
    expect(mensaje({ ...BASE, LOG_LEVEL: "verbose" })).toContain('LOG_LEVEL inválido: "verbose"');
  });

  it("APP_MIN_VERSION debe ser una versión", () => {
    for (const buena of ["1", "0.2", "0.2.0", "1.2.3.4", "0.2.0-debug"]) expect(leerConfiguracion({ ...BASE, APP_MIN_VERSION: buena }).versionMinima).toBe(buena);
    for (const mala of ["abc", "1.2.3.4.5", "v1.0", "1."]) expect(mensaje({ ...BASE, APP_MIN_VERSION: mala })).toBe(`configuración inválida: APP_MIN_VERSION no es una versión (llegó "${mala}")`);
  });

  it("informa todos los problemas juntos, separados por punto y coma, para corregirlos de una vez", () => {
    const m = mensaje({ PORT: "x", LOG_LEVEL: "y", APP_MIN_VERSION: "z" });
    expect(m.startsWith("configuración inválida: ")).toBe(true);
    expect(m.split("; ")).toHaveLength(6);
    for (const parte of ["PORT", "DATA_DIR", "ADJUNTOS_DIR", "PEPPER_FILE", "LOG_LEVEL", "APP_MIN_VERSION"]) expect(m).toContain(parte);
  });

  it("ignora el resto del entorno y no lo copia", () => {
    const c = leerConfiguracion({ ...BASE, PATH: "/usr/bin", SECRETO: "x" });
    expect(Object.keys(c).sort()).toEqual(["archivoPepper", "dirAdjuntos", "dirDatos", "nivelDeLog", "puerto"]);
  });
});
