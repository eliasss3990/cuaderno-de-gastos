// Dinero: siempre un entero en la unidad menor de la moneda (nunca un flotante).
// Formato: "." para los miles y "," para los decimales, en todas las monedas.
// El módulo no conoce ninguna moneda concreta: recibe sus datos (código, decimales y símbolo).
package com.eliasgonzalez.cuadernodegastos.dominio.base

import java.math.BigInteger

data class Moneda(val codigo: String, val decimales: Int, val simbolo: String)

enum class ErrorMonto(val codigo: String) {
    VACIO("vacio"),
    FORMATO("formato"),
    DECIMALES_DE_MAS("decimales_de_mas"),
    FUERA_DE_RANGO("fuera_de_rango"),
}

sealed interface ResultadoParseo {
    data class Ok(val minor: Long) : ResultadoParseo

    data class Error(val error: ErrorMonto) : ResultadoParseo
}

object Dinero {
    /** Mayor monto en la unidad menor: el entero seguro de JavaScript (el servidor no puede representar más). */
    const val MAX_MONTO_MINOR: Long = 9_007_199_254_740_991L

    /** Mayor cantidad de decimales que admite una moneda. */
    const val MAX_DECIMALES: Int = 4

    private val MAX_BIG: BigInteger = BigInteger.valueOf(MAX_MONTO_MINOR)
    private val MILES = Regex("""\B(?=(\d{3})+(?!\d))""")
    private val PATRON = Regex("""^(0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:\.[0-9]{3})+)(?:,([0-9]+))?$""")
    private val CEROS_A_LA_IZQUIERDA = Regex("""^0+(?=\d)""")

    private fun comprobarDecimales(decimales: Int) {
        require(decimales in 0..MAX_DECIMALES) { "los decimales deben ser un entero entre 0 y $MAX_DECIMALES, llegó $decimales" }
    }

    private fun comprobarMinor(minor: Long) {
        require(minor in -MAX_MONTO_MINOR..MAX_MONTO_MINOR) { "el monto debe ser un entero seguro, llegó $minor" }
    }

    private fun agrupar(enteros: String): String = enteros.replace(MILES, ".")

    /** Número sin símbolo: 123456 con 2 decimales -> "1.234,56". Un negativo lleva "-" delante. */
    fun formatearNumero(minor: Long, decimales: Int): String {
        comprobarMinor(minor)
        comprobarDecimales(decimales)
        val digitos = Math.abs(minor).toString().padStart(decimales + 1, '0')
        val enteros = digitos.substring(0, digitos.length - decimales)
        val decimal = digitos.substring(digitos.length - decimales)
        return (if (minor < 0) "-" else "") + agrupar(enteros) + (if (decimales > 0) ",$decimal" else "")
    }

    /** Monto con símbolo: "R$ 1.234,56", "₲ 1.234.567". Un negativo lleva "-" antes del símbolo. */
    fun formatear(minor: Long, moneda: Moneda): String {
        comprobarMinor(minor)
        val numero = formatearNumero(Math.abs(minor), moneda.decimales)
        return "${if (minor < 0) "-" else ""}${moneda.simbolo} $numero"
    }

    private fun valorDe(enteros: String, decimal: String, decimales: Int): BigInteger =
        BigInteger(enteros.ifEmpty { "0" }) * BigInteger.TEN.pow(decimales) + BigInteger(decimal.padEnd(decimales, '0').ifEmpty { "0" })

    /**
     * Lee un monto escrito como "1.234,56" (los puntos solo como separador de miles, en grupos de tres).
     * Acepta menos decimales de los que tiene la moneda ("12,9" en reales es 12,90); rechaza de más.
     * Un texto que termina en coma ("12,") todavía no es un monto: da `formato` (sí es válido mientras se escribe).
     */
    fun parsear(texto: String, moneda: Moneda): ResultadoParseo {
        comprobarDecimales(moneda.decimales)
        if (texto.isEmpty()) return ResultadoParseo.Error(ErrorMonto.VACIO)
        val m = PATRON.matchEntire(texto) ?: return ResultadoParseo.Error(ErrorMonto.FORMATO)
        val enteros = m.groupValues[1].replace(".", "")
        val decimal = m.groupValues[2]
        if (decimal.length > moneda.decimales) return ResultadoParseo.Error(ErrorMonto.DECIMALES_DE_MAS)
        val valor = valorDe(enteros, decimal, moneda.decimales)
        if (valor > MAX_BIG) return ResultadoParseo.Error(ErrorMonto.FUERA_DE_RANGO)
        return ResultadoParseo.Ok(valor.toLong())
    }

    /**
     * Da formato al texto mientras se escribe. Recibe lo que hay en el campo (dígitos y a lo sumo una coma;
     * se ignora cualquier otro carácter) y devuelve el texto formateado. Quita ceros a la izquierda, descarta
     * decimales de más y, si el valor pasaría el máximo, descarta los últimos dígitos hasta que entre.
     * Los puntos se ignoran siempre (en pantalla solo aparecen como separador de miles): escribir "1.5" da "15".
     */
    fun formatearEntrada(crudo: String, moneda: Moneda): String {
        comprobarDecimales(moneda.decimales)
        val enteros = StringBuilder()
        val decimal = StringBuilder()
        var hayComa = false
        for (c in crudo) {
            if (c in '0'..'9') {
                if (hayComa) decimal.append(c) else enteros.append(c)
            } else if (c == ',' && moneda.decimales > 0 && !hayComa) {
                hayComa = true
            }
        }
        var e = enteros.toString().replace(CEROS_A_LA_IZQUIERDA, "")
        var d = decimal.toString()
        if (e.isEmpty() && !hayComa && d.isEmpty()) return ""
        if (e.isEmpty()) e = "0"
        d = d.take(moneda.decimales)
        while (valorDe(e, d, moneda.decimales) > MAX_BIG) {
            if (d.isNotEmpty()) d = d.dropLast(1) else e = e.dropLast(1)
        }
        return agrupar(e) + (if (hayComa) ",$d" else "")
    }

    /** Cociente entero redondeado hacia abajo (hacia menos infinito). `b` debe ser un entero mayor que cero. */
    fun dividirHaciaAbajo(a: Long, b: Long): Long {
        comprobarMinor(a)
        require(b in 1..MAX_MONTO_MINOR) { "el divisor debe ser un entero mayor que cero, llegó $b" }
        return Math.floorDiv(a, b)
    }
}
