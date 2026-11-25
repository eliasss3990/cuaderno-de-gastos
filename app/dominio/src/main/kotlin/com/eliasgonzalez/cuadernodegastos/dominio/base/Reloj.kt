// Reloj híbrido: una marca (milisegundos, contador, dispositivo) que ordena las ediciones aunque los
// relojes de los celulares no coincidan. Como texto de largo fijo, comparar el texto es comparar el reloj:
//   "{ms:013x}-{contador:04x}-{dispositivo}"   (hexadecimal en minúsculas; el dispositivo es un UUID en minúsculas)
// El módulo es puro: nunca lee la hora, la recibe como argumento.
package com.eliasgonzalez.cuadernodegastos.dominio.base

data class Hlc(val ms: Long, val contador: Int, val dispositivo: String)

/** Milisegundos y contador de una marca, sin el dispositivo (la "última marca" propia o una remota). */
data class Instante(val ms: Long, val contador: Int)

data class MarcaCorregida(val hlc: Hlc, val corregida: Boolean)

object Reloj {
    /** Mayor valor de milisegundos que entra en 13 dígitos hexadecimales. */
    const val MAX_MS: Long = 0xfffffffffffffL

    /** Mayor valor del contador (4 dígitos hexadecimales). */
    const val MAX_CONTADOR: Int = 0xffff

    /** Una marca más de este tiempo en el futuro respecto del reloj del servidor se corrige. */
    const val TOLERANCIA_FUTURO_MS: Long = 5 * 60 * 1000

    /** El entero seguro de JavaScript: el servidor no puede representar un desfase mayor. */
    private const val MAX_ENTERO_SEGURO: Long = 9_007_199_254_740_991L

    private const val UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

    // matchEntire y no anclas: en Java "$" acepta un salto de línea final, en JavaScript no
    private val PATRON = Regex("([0-9a-f]{13})-([0-9a-f]{4})-($UUID)")
    private val PATRON_UUID = Regex(UUID)

    private fun entero(valor: Long, max: Long, nombre: String) {
        require(valor in 0..max) { "$nombre debe ser un entero entre 0 y $max, llegó $valor" }
    }

    private fun dispositivoValido(dispositivo: String) {
        require(PATRON_UUID.matches(dispositivo)) { "el dispositivo debe ser un UUID en minúsculas, llegó '$dispositivo'" }
    }

    private fun validar(h: Hlc) {
        entero(h.ms, MAX_MS, "los milisegundos")
        entero(h.contador.toLong(), MAX_CONTADOR.toLong(), "el contador")
        dispositivoValido(h.dispositivo)
    }

    private fun validar(i: Instante, cual: String) {
        entero(i.ms, MAX_MS, "los milisegundos de $cual")
        entero(i.contador.toLong(), MAX_CONTADOR.toLong(), "el contador de $cual")
    }

    fun formatear(h: Hlc): String {
        validar(h)
        return "${h.ms.toString(16).padStart(13, '0')}-${h.contador.toString(16).padStart(4, '0')}-${h.dispositivo}"
    }

    /** La marca, o null si el texto no tiene exactamente la forma de una. */
    fun parsear(texto: String): Hlc? {
        val m = PATRON.matchEntire(texto) ?: return null
        return Hlc(m.groupValues[1].toLong(16), m.groupValues[2].toInt(16), m.groupValues[3])
    }

    /**
     * Orden total: primero milisegundos, luego contador, luego el dispositivo (como texto). Devuelve -1, 0 o 1.
     * Es el mismo orden que el del texto formateado. Falla si alguna marca no es válida.
     */
    fun comparar(a: Hlc, b: Hlc): Int {
        validar(a)
        validar(b)
        return when {
            a.ms != b.ms -> if (a.ms < b.ms) -1 else 1
            a.contador != b.contador -> if (a.contador < b.contador) -1 else 1
            a.dispositivo != b.dispositivo -> if (a.dispositivo < b.dispositivo) -1 else 1
            else -> 0
        }
    }

    /**
     * Regla de recibir: la "última" marca después de ver una de otro dispositivo es la mayor entre la propia y la
     * remota (por milisegundos y contador). Solo se deben observar marcas ya corregidas por el servidor: observar una
     * absurda dejaría al dispositivo anclado en ese futuro. La próxima marca propia sale de `siguiente` con este resultado.
     */
    fun observar(ultimo: Instante?, remota: Instante): Instante {
        validar(remota, "la marca remota")
        if (ultimo == null) return remota
        validar(ultimo, "la última marca")
        val remotaMayor = remota.ms > ultimo.ms || (remota.ms == ultimo.ms && remota.contador > ultimo.contador)
        return if (remotaMayor) remota else ultimo
    }

    /**
     * Marca siguiente de este dispositivo. Usa la hora del reloj pero nunca retrocede: si el reloj atrasó o
     * se repite el milisegundo, sube el contador; si el contador se desborda, avanza un milisegundo.
     */
    fun siguiente(ultimo: Instante?, ahoraMs: Long, dispositivo: String): Hlc {
        entero(ahoraMs, MAX_MS, "la hora")
        dispositivoValido(dispositivo)
        var ms = ahoraMs
        var contador = 0
        if (ultimo != null) {
            validar(ultimo, "la última marca")
            if (ultimo.ms >= ahoraMs) {
                ms = ultimo.ms
                contador = ultimo.contador + 1
            }
        }
        if (contador > MAX_CONTADOR) {
            ms += 1
            contador = 0
        }
        entero(ms, MAX_MS, "los milisegundos de la marca nueva")
        return Hlc(ms, contador, dispositivo)
    }

    /**
     * Si la marca está más de cinco minutos en el futuro respecto de la hora del servidor, la reemplaza por una a partir
     * de esa hora (mismo dispositivo), generada después de la última marca guardada del dispositivo. Lo usa el servidor;
     * la app lo comparte para entender la marca que el servidor le devuelve. El celular reemplaza su marca por la
     * devuelta y recalcula su última marca desde ella; si su última marca está muy en el futuro, la corregida también.
     */
    fun corregirFuturo(h: Hlc, ahoraServidorMs: Long, ultimoDelDispositivo: Instante?): MarcaCorregida {
        entero(ahoraServidorMs, MAX_MS, "la hora del servidor")
        validar(h)
        if (ultimoDelDispositivo != null) validar(ultimoDelDispositivo, "la última marca del dispositivo")
        if (h.ms <= ahoraServidorMs + TOLERANCIA_FUTURO_MS) return MarcaCorregida(h, false)
        return MarcaCorregida(siguiente(ultimoDelDispositivo, ahoraServidorMs, h.dispositivo), true)
    }

    /** Desfase del celular: hora del servidor menos hora del celular. */
    fun aprenderDesfase(servidorMs: Long, localMs: Long): Long {
        entero(servidorMs, MAX_MS, "la hora del servidor")
        entero(localMs, MAX_MS, "la hora del celular")
        return servidorMs - localMs
    }

    /** Hora del celular corregida con el desfase aprendido, acotada entre 0 y el máximo: es la que se pasa a `siguiente`. */
    fun ahoraCorregida(localMs: Long, desfaseMs: Long): Long {
        entero(localMs, MAX_MS, "la hora del celular")
        require(desfaseMs in -MAX_ENTERO_SEGURO..MAX_ENTERO_SEGURO) { "el desfase debe ser un entero, llegó $desfaseMs" }
        return (localMs + desfaseMs).coerceIn(0, MAX_MS)
    }
}
