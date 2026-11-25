package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** Diferencias entre Kotlin/Java y JavaScript que la validación tiene que tapar para decidir igual que el servidor. */
class ValidacionTest {
    private fun gasto(campos: String) = Operacion(
        opId = "018f3a6e-9000-7000-8000-000000000001",
        tipo = "expense.create",
        entidadTipo = "expense",
        entidadId = "018f3a6e-1000-7000-8000-000000000001",
        hlc = "00018bcfe5680-0000-018f3a6e-0000-7000-8000-00000000000a",
        payload = Json.parseToJsonElement(
            """{"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":1700000000000,"dia_imputado":"2027-02-18"${if (campos.isEmpty()) "" else ",$campos"}}""",
        ).jsonObject,
        schemaVersion = 1,
    )

    private fun ok(campos: String) = assertEquals(campos, ResultadoValidacion.Ok, Validacion.validar(gasto(campos)))

    private fun no(campos: String) = assertNotEquals(campos, ResultadoValidacion.Ok, Validacion.validar(gasto(campos)))

    @Test
    fun losNumerosSonLosDeJavaScript() {
        ok(""""monto_minor":1""")
        ok(""""monto_minor":1.0""") // para JavaScript es el entero 1
        ok(""""monto_minor":1e3""")
        ok(""""monto_minor":9007199254740991""")
        no(""""monto_minor":9007199254740992""")
        no(""""monto_minor":1.5""")
        no(""""monto_minor":1e400""")
        no(""""monto_minor":"1"""")
        no(""""monto_minor":true""")
        ok(""""monto_minor":1,"cuando_ocurrio":0""")
        no(""""monto_minor":1,"cuando_ocurrio":-0""") // -0 no es un entero válido
        no(""""monto_minor":1,"cuando_ocurrio":-0.0""")
    }

    @Test
    fun losTextosSeMidenYRevisanComoEnJavaScript() {
        ok(""""monto_minor":1,"concepto":"${"😀".repeat(100)}"""") // 200 unidades UTF-16
        no(""""monto_minor":1,"concepto":"${"😀".repeat(100)}x"""")
        no(""""monto_minor":1,"concepto":"\ud83d"""") // sustituto suelto
        no(""""monto_minor":1,"concepto":"a\u0085"""")
        ok(""""monto_minor":1,"nota":"a\nb\tc"""")
        no(""""monto_minor":1,"concepto":"a\nb"""")
        // en Java "$" acepta un salto de línea final; en JavaScript no
        no(""""monto_minor":1,"moneda":"PYG\n"""")
        no(""""monto_minor":1,"dia_imputado":"2027-02-18\n"""")
    }

    @Test
    fun elEnlaceNoAdmiteEspaciosUnicodeComoEnJavaScript() {
        fun fijo(enlace: String) = Validacion.validar(
            gasto("").copy(
                tipo = "fixed.create",
                entidadTipo = "fixed_cost",
                payload = Json.parseToJsonElement("""{"nombre":"Hotel","moneda":"PYG","monto_unitario_minor":1,"cantidad":1,"enlace_mapa":"$enlace"}""").jsonObject,
            ),
        )
        assertEquals(ResultadoValidacion.Ok, fijo("https://x.y/a"))
        for (espacio in listOf("\\u00a0", "\\u2028", "\\u3000", "\\ufeff", "\\u2009")) {
            assertNotEquals(espacio, ResultadoValidacion.Ok, fijo("https://x.y/a${espacio}b"))
        }
    }

    @Test
    fun elTotalDelFijoNoDesborda() {
        fun fijo(unitario: String, cantidad: String) = Validacion.validar(
            gasto("").copy(
                tipo = "fixed.create",
                entidadTipo = "fixed_cost",
                payload = Json.parseToJsonElement("""{"nombre":"Hotel","moneda":"PYG","monto_unitario_minor":$unitario,"cantidad":$cantidad}""").jsonObject,
            ),
        )
        assertEquals(ResultadoValidacion.Ok, fijo("90071992547409", "100"))
        assertNotEquals(ResultadoValidacion.Ok, fijo("90071992547410", "100"))
        assertNotEquals(ResultadoValidacion.Ok, fijo("9007199254740991", "100000")) // el producto no entra en un Long
    }
}
