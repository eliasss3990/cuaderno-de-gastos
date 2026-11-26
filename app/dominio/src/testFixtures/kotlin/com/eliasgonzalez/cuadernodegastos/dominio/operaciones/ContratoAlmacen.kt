package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Un almacén con lo que el contrato necesita mirar desde afuera. */
interface AlmacenObservable : Almacen {
    /** Vista ordenada del estado, en la forma de los vectores de conformidad. */
    fun instantanea(): JsonObject

    /** Números de secuencia de las operaciones guardadas, ordenados. */
    fun secuencias(): List<Long>
}

/** Contrato que debe cumplir cualquier almacén: el de memoria y el de SQLite pasan exactamente las mismas pruebas. */
abstract class ContratoAlmacen {
    protected abstract fun crear(): AlmacenObservable

    private val marca1 = "0000000000064-0000-018f3a6e-0000-7000-8000-00000000000a"
    private val marca2 = "00000000000c8-0000-018f3a6e-0000-7000-8000-00000000000a"
    private val marcas = HashMap<String, String>()

    // cada operación lleva su propia marca (la marca es única por operación), salvo que la prueba pida una
    private fun marcaPropia(opId: String) = marcas.getOrPut(opId) { "${(1000 + marcas.size).toString(16).padStart(13, '0')}-0000-018f3a6e-0000-7000-8000-00000000000a" }

    private fun op(
        opId: String,
        hlc: String = marcaPropia(opId),
        entidadTipo: String = "expense",
        entidadId: String = "e1",
        padreId: String? = null,
        payload: JsonObject? = JsonObject(mapOf("concepto" to JsonPrimitive("x"))),
    ) = OpGuardada(opId, "expense.update", entidadTipo, entidadId, hlc, payload, payload == null, padreId, 1)

    private fun s(v: String) = JsonPrimitive(v)

    private fun <T> falla(fn: () -> T) {
        try {
            fn()
        } catch (_: IllegalStateException) {
            return
        }
        throw AssertionError("no falló")
    }

    @Test
    fun entidadesDeTraeLasVivasDeEseTipoConTodosSusCampos() {
        val a = crear()
        a.crearEntidad("expense", "e1")
        a.escribirCampo("expense", "e1", "nota", s("a"), marca1)
        a.escribirCampo("expense", "e1", "monto_minor", JsonPrimitive(1500), marca1)
        a.escribirCampo("expense", "e1", "concepto", JsonNull, marca1)
        // sin campos escritos también aparece
        a.crearEntidad("expense", "e2")
        a.crearEntidad("category", "c1")
        a.escribirCampo("category", "c1", "nombre", s("Comida"), marca1)
        // terminada: no aparece
        a.crearEntidad("expense", "e3")
        a.escribirCampo("expense", "e3", "nota", s("b"), marca1)
        a.terminar("expense", "e3")
        assertEquals(
            mapOf("e1" to mapOf("nota" to s("a"), "monto_minor" to JsonPrimitive(1500), "concepto" to JsonNull), "e2" to emptyMap<String, JsonElement>()),
            a.entidadesDe("expense"),
        )
        assertEquals(mapOf("c1" to mapOf("nombre" to s("Comida"))), a.entidadesDe("category"))
        assertEquals(emptyMap<String, Map<String, JsonElement>>(), a.entidadesDe("member"))
    }

    @Test
    fun crearUnaEntidadEsIdempotenteYNoBorraLoEscrito() {
        val a = crear()
        a.crearEntidad("expense", "e1")
        a.escribirCampo("expense", "e1", "nota", s("a"), marca1)
        a.crearEntidad("expense", "e1")
        assertEquals(s("a"), a.leerCampo("expense", "e1", "nota"))
        assertTrue(a.entidadExiste("expense", "e1"))
        assertFalse(a.entidadExiste("expense", "e2"))
    }

    @Test
    fun unCampoSinEscribirNoTieneRelojYEscribirLoActualiza() {
        val a = crear()
        a.crearEntidad("expense", "e1")
        assertNull(a.leerReloj("expense", "e1", "nota"))
        a.escribirCampo("expense", "e1", "nota", s("a"), marca1)
        assertEquals(marca1, a.leerReloj("expense", "e1", "nota"))
        a.escribirCampo("expense", "e1", "nota", s("b"), marca2)
        assertEquals(marca2, a.leerReloj("expense", "e1", "nota"))
        assertEquals(s("b"), a.leerCampo("expense", "e1", "nota"))
    }

    @Test
    fun terminarBorraLaEntidadYDejaLaLapidaTambienSiNuncaExistio() {
        val a = crear()
        a.crearEntidad("expense", "e1")
        a.escribirCampo("expense", "e1", "nota", s("a"), marca1)
        a.terminar("expense", "e1")
        assertFalse(a.entidadExiste("expense", "e1"))
        assertTrue(a.entidadTerminada("expense", "e1"))
        assertNull(a.leerCampo("expense", "e1", "nota"))
        a.terminar("fixed_cost", "f9")
        assertTrue(a.entidadTerminada("fixed_cost", "f9"))
        a.terminar("expense", "e1") // dos veces no falla
        assertTrue(a.entidadTerminada("expense", "e1"))
    }

    @Test
    fun laSecuenciaEmpiezaEn1YCreceDeAUno() {
        val a = crear()
        assertEquals(1L, a.guardarOp(op("o1")))
        assertEquals(2L, a.guardarOp(op("o2")))
        assertTrue(a.opConocida("o1"))
        assertFalse(a.opConocida("o3"))
        assertEquals(listOf(1L, 2L), a.secuencias())
    }

    @Test
    fun redactarPorEntidadSoloTocaLasDeEsaEntidad() {
        val a = crear()
        a.guardarOp(op("o1", entidadId = "e1"))
        a.guardarOp(op("o2", entidadId = "e2"))
        a.redactarPorEntidad("expense", "e1")
        val ops = a.instantanea()["ops"].toString()
        assertTrue(ops, ops.contains("\"opId\":\"o1\",\"tipo\":\"expense.update\",\"entidadTipo\":\"expense\",\"entidadId\":\"e1\",\"hlc\":\"${marcaPropia("o1")}\",\"payload\":null,\"redactada\":true"))
        assertTrue(ops, ops.contains("\"opId\":\"o2\",\"tipo\":\"expense.update\",\"entidadTipo\":\"expense\",\"entidadId\":\"e2\",\"hlc\":\"${marcaPropia("o2")}\",\"payload\":{\"concepto\":\"x\"},\"redactada\":false"))
    }

    @Test
    fun redactarPorPadreAlcanzaALosHijosYElPadreRegistradoSobrevive() {
        val a = crear()
        a.guardarOp(op("o1", entidadTipo = "attachment", entidadId = "a1", padreId = "e1"))
        a.guardarOp(op("o2", entidadTipo = "attachment", entidadId = "a2", padreId = "e2"))
        a.redactarPorPadre("e1")
        assertEquals("e1", a.padreRegistrado("attachment", "a1"))
        val ops = a.instantanea()["ops"].toString()
        assertTrue(ops, ops.contains("\"entidadId\":\"a1\",\"hlc\":\"${marcaPropia("o1")}\",\"payload\":null,\"redactada\":true"))
        assertTrue(ops, ops.contains("\"entidadId\":\"a2\",\"hlc\":\"${marcaPropia("o2")}\",\"payload\":{\"concepto\":\"x\"},\"redactada\":false"))
    }

    @Test
    fun losAdjuntosDeUnDuenoIncluyenLosQuitadosExcluyenLosDeOtrosYSalenOrdenados() {
        val a = crear()
        for ((adj, dueno) in listOf("a3" to "e1", "a1" to "e1", "a2" to "e1", "a4" to "e2")) {
            a.crearEntidad("attachment", adj)
            a.escribirCampo("attachment", adj, "owner_id", s(dueno), marca1)
        }
        a.escribirCampo("attachment", "a2", "quitado", JsonPrimitive(1), marca2)
        assertEquals(listOf("a1", "a2", "a3"), a.adjuntosDe("e1"))
        assertEquals(listOf("a4"), a.adjuntosDe("e2"))
        assertEquals(emptyList<String>(), a.adjuntosDe("e9"))
    }

    @Test
    fun unaTransaccionQueFallaDeshaceTodo() {
        val a = crear()
        a.crearEntidad("expense", "e0")
        a.escribirCampo("expense", "e0", "nota", s("a"), marca1)
        a.guardarOp(op("o0", hlc = marca1, entidadId = "e0"))
        val antes = a.instantanea()
        falla {
            a.transaccion {
                a.crearEntidad("expense", "e1")
                a.escribirCampo("expense", "e1", "nota", s("x"), marca2)
                a.escribirCampo("expense", "e0", "nota", s("b"), marca2)
                a.escribirCampo("expense", "e0", "lugar", s("l"), marca2)
                a.guardarOp(op("o1", hlc = marca2, entidadId = "e0"))
                a.redactarPorEntidad("expense", "e0")
                a.terminar("expense", "e0")
                a.abrirIntervalo(10, IntervaloCierre.Causa.MANUAL)
                error("falla")
            }
        }
        assertEquals(antes, a.instantanea())
        assertFalse(a.marcaEnUso(marca2))
        assertEquals(emptyList<IntervaloCierre>(), a.intervalosDeCierre())
        assertEquals(2L, a.guardarOp(op("o2", hlc = marca2))) // la secuencia vuelve a donde estaba
    }

    @Test
    fun unaTransaccionQueTerminaBienConservaLoEscritoYDevuelveElResultado() {
        val a = crear()
        val r = a.transaccion {
            a.crearEntidad("expense", "e1")
            a.guardarOp(op("o1"))
        }
        assertEquals(1L, r)
        assertTrue(a.entidadExiste("expense", "e1"))
        assertTrue(a.opConocida("o1"))
    }

    @Test
    fun unaTransaccionAnidadaFormaParteDeLaExterna() {
        val a = crear()
        falla {
            a.transaccion {
                a.transaccion { a.crearEntidad("expense", "e1") }
                error("falla")
            }
        }
        assertFalse(a.entidadExiste("expense", "e1"))
        // si la interna falla y la externa lo captura, lo escrito se conserva (sin puntos de guardado)
        a.transaccion {
            try {
                a.transaccion {
                    a.crearEntidad("expense", "e2")
                    error("falla interna")
                }
            } catch (_: IllegalStateException) {
            }
            a.crearEntidad("expense", "e3")
        }
        assertTrue(a.entidadExiste("expense", "e2"))
        assertTrue(a.entidadExiste("expense", "e3"))
    }

    @Test
    fun crearYTerminarDentroDeUnaTransaccionQueFallaNoDejaNiEntidadNiLapida() {
        val a = crear()
        falla {
            a.transaccion {
                a.crearEntidad("expense", "e1")
                a.terminar("expense", "e1")
                error("falla")
            }
        }
        assertFalse(a.entidadExiste("expense", "e1"))
        assertFalse(a.entidadTerminada("expense", "e1"))
        a.crearEntidad("expense", "e2")
        a.terminar("expense", "e2")
        falla {
            a.transaccion {
                a.terminar("expense", "e2")
                error("falla")
            }
        }
        assertTrue(a.entidadTerminada("expense", "e2"))
    }

    @Test
    fun lasMarcasEnUsoIncluyenLasDeLasRedactadas() {
        val a = crear()
        assertFalse(a.marcaEnUso(marca1))
        a.guardarOp(op("o1", hlc = marca1))
        assertTrue(a.marcaEnUso(marca1))
        a.redactarPorEntidad("expense", "e1")
        assertTrue(a.marcaEnUso(marca1))
        assertFalse(a.marcaEnUso(marca2))
    }

    @Test
    fun leerCampoDistingueAusenteDeNullYGuardaValoresCompuestos() {
        val a = crear()
        assertNull(a.leerCampo("expense", "e1", "nota"))
        a.crearEntidad("expense", "e1")
        assertNull(a.leerCampo("expense", "e1", "nota"))
        a.escribirCampo("expense", "e1", "nota", s("a"), marca1)
        a.escribirCampo("expense", "e1", "vacio", JsonNull, marca1)
        val compuesto = buildJsonObject {
            put("lista", buildJsonArray { add(JsonPrimitive(1)); add(JsonPrimitive("dos")) })
            put("texto", "con \"comillas\" y ñ 😀")
        }
        a.escribirCampo("expense", "e1", "extra", compuesto, marca1)
        assertEquals(s("a"), a.leerCampo("expense", "e1", "nota"))
        assertEquals(JsonNull, a.leerCampo("expense", "e1", "vacio"))
        assertEquals(compuesto, a.leerCampo("expense", "e1", "extra"))
        a.terminar("expense", "e1")
        assertNull(a.leerCampo("expense", "e1", "nota"))
    }

    @Test
    fun contarEntidadesNoCuentaLasTerminadasYIdDelViaje() {
        val a = crear()
        assertEquals(0, a.contarEntidades("shortcut"))
        for (id in listOf("s1", "s2", "s3")) a.crearEntidad("shortcut", id)
        a.crearEntidad("expense", "e1")
        a.terminar("shortcut", "s2")
        assertEquals(2, a.contarEntidades("shortcut"))
        assertEquals(1, a.contarEntidades("expense"))
        assertNull(a.idDelViaje())
        a.crearEntidad("trip", "v1")
        assertEquals("v1", a.idDelViaje())
    }

    @Test
    fun noSeGuardaDosVecesLaMismaOperacionNiDosConLaMismaMarca() {
        val a = crear()
        a.guardarOp(op("o1", hlc = marca1))
        assertThrows(Exception::class.java) { a.guardarOp(op("o1", hlc = marca2)) }
        assertThrows(Exception::class.java) { a.guardarOp(op("o2", hlc = marca1)) }
        assertFalse(a.opConocida("o2"))
        assertFalse(a.marcaEnUso(marca2))
        assertEquals(2L, a.guardarOp(op("o3", hlc = marca2))) // los intentos fallidos no movieron la secuencia
    }

    @Test
    fun escribirUnCampoDeUnaEntidadQueNoExisteFalla() {
        val e = assertThrows(IllegalStateException::class.java) { crear().escribirCampo("expense", "nada", "nota", s("x"), marca1) }
        assertTrue(e.message!!.contains("no existe"))
    }

    @Test
    fun padreRegistradoDevuelveElPrimeroYSeSaltaLasOperacionesSinPadre() {
        val a = crear()
        assertNull(a.padreRegistrado("attachment", "a1"))
        a.guardarOp(op("o0", entidadTipo = "attachment", entidadId = "a1"))
        assertNull(a.padreRegistrado("attachment", "a1"))
        a.guardarOp(op("o1", entidadTipo = "attachment", entidadId = "a1", padreId = "p1"))
        a.guardarOp(op("o2", entidadTipo = "attachment", entidadId = "a1", padreId = "p2"))
        assertEquals("p1", a.padreRegistrado("attachment", "a1"))
        assertNull(a.padreRegistrado("attachment", "otro"))
    }

    @Test
    fun intervalosDeCierre() {
        val a = crear()
        assertEquals(emptyList<IntervaloCierre>(), a.intervalosDeCierre())
        falla { a.cerrarIntervalo(10) }
        a.abrirIntervalo(100, IntervaloCierre.Causa.MANUAL)
        falla { a.abrirIntervalo(150, IntervaloCierre.Causa.FECHAS) }
        falla { a.cerrarIntervalo(100) }
        falla { a.cerrarIntervalo(99) }
        a.cerrarIntervalo(200)
        falla { a.cerrarIntervalo(300) }
        falla { a.abrirIntervalo(199, IntervaloCierre.Causa.FECHAS) }
        a.abrirIntervalo(200, IntervaloCierre.Causa.FECHAS)
        a.cerrarIntervalo(300)
        // con varios guardados se compara con el último, no con el primero
        falla { a.abrirIntervalo(250, IntervaloCierre.Causa.MANUAL) }
        falla { a.abrirIntervalo(299, IntervaloCierre.Causa.MANUAL) }
        a.abrirIntervalo(300, IntervaloCierre.Causa.MANUAL)
        assertEquals(
            listOf(
                IntervaloCierre(100, 200, IntervaloCierre.Causa.MANUAL),
                IntervaloCierre(200, 300, IntervaloCierre.Causa.FECHAS),
                IntervaloCierre(300, null, IntervaloCierre.Causa.MANUAL),
            ),
            a.intervalosDeCierre(),
        )
    }
}
