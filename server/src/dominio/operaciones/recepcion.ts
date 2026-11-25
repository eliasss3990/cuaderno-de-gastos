// Recepción de un lote de operaciones de un dispositivo: por cada una, y en una transacción propia, que la marca sea
// del dispositivo que la envía, la corrección de marcas del futuro y la ingesta (formato, duplicado, cierre del viaje,
// estado, aplicar); un duplicado devuelve la secuencia y la marca final de la primera vez. Un rechazo no frena a las demás operaciones del lote. Las
// operaciones que dependen de otra rechazada fallan solas, porque la entidad no existe.

import { Ingesta, type Remitente } from "./ingesta.js";
import type { Almacen, Operacion, Razon } from "./operaciones.js";
import { corregirMarcaFutura, formatearHlc, parsearHlc } from "../base/reloj.js";

export const MAX_OPERACIONES_POR_LOTE = 100;

/** Índice (desde 0) donde empieza el dispositivo dentro de una marca: 13 de milisegundos, guion, 4 del contador y otro guion. */
const DISPOSITIVO_DESDE = 19;

export interface ResultadoDeOperacion {
  /** Id de la operación; vacío si lo que llegó ni siquiera tenía uno. */
  readonly opId: string;
  readonly estado: "accepted" | "duplicate" | "rejected";
  /** Número de secuencia (solo si se aceptó o ya estaba guardada). */
  readonly seq?: number;
  readonly razon?: Razon;
  /** Marca final: la enviada, salvo que el servidor la haya corregido (o, en un duplicado, la guardada). */
  readonly hlc: string;
}

export class LoteInvalidoError extends Error {}

export class RecepcionDeOperaciones {
  private readonly ingesta: Ingesta;

  /** `ahora` es el reloj del servidor (ms). */
  constructor(private readonly almacen: Almacen, private readonly ahora: () => number = Date.now) {
    this.ingesta = new Ingesta(almacen, ahora);
  }

  procesarLote(operaciones: readonly Operacion[], remitente: Remitente): ResultadoDeOperacion[] {
    if (!Array.isArray(operaciones) || operaciones.length === 0) throw new LoteInvalidoError("el lote está vacío");
    if (operaciones.length > MAX_OPERACIONES_POR_LOTE) throw new LoteInvalidoError(`el lote tiene más de ${MAX_OPERACIONES_POR_LOTE} operaciones`);
    return operaciones.map((op) => this.procesar(op, remitente));
  }

  private procesar(op: Operacion, remitente: Remitente): ResultadoDeOperacion {
    const dispositivoId = remitente.deviceId;
    if ((op as unknown) === null || typeof op !== "object") return { opId: "", estado: "rejected", razon: "formato", hlc: "" };
    const opId = typeof op.opId === "string" ? op.opId : "";
    const enviada = typeof op.hlc === "string" ? op.hlc : "";
    const rechazada = (razon: Razon): ResultadoDeOperacion => ({ opId, estado: "rejected", razon, hlc: enviada });
    return this.almacen.transaccion((): ResultadoDeOperacion => {
      const marca = parsearHlc(enviada); // `enviada` es "" si la marca no era texto
      if (!marca.ok || marca.hlc.dispositivo !== dispositivoId) return rechazada("formato");
      // un op_id ya guardado por otro dispositivo no se puede repetir ni devolver como duplicado
      const previa = this.almacen.buscarOp(opId);
      if (previa !== null && previa.hlc.slice(DISPOSITIVO_DESDE) !== dispositivoId) return rechazada("formato");

      const ultima = this.almacen.ultimaMarcaDe(dispositivoId);
      const ultimaMarca = ultima === null ? null : parsearHlc(ultima);
      const corregida = corregirMarcaFutura(marca.hlc, this.ahora(), ultimaMarca !== null && ultimaMarca.ok ? ultimaMarca.hlc : null);

      const resultado = this.ingesta.procesar(corregida.corregida ? { ...op, hlc: formatearHlc(corregida.hlc) } : op, remitente);
      if (resultado.estado === "rejected") return rechazada(resultado.razon);
      // lo que se devuelve es lo que quedó guardado: en un duplicado, la secuencia y la marca final de la primera vez
      const guardada = this.almacen.buscarOp(op.opId);
      if (guardada === null) throw new Error("la operación aceptada no quedó guardada");
      return { opId, estado: resultado.estado, seq: guardada.seq, hlc: guardada.hlc };
    });
  }
}
