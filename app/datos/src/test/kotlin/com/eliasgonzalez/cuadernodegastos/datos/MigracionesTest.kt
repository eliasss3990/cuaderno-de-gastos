package com.eliasgonzalez.cuadernodegastos.datos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MigracionesTest {
    private fun version(b: BaseSql) = b.consultar("PRAGMA user_version").single()[0] as Long

    @Test
    fun unaBaseNuevaQuedaEnLaUltimaVersionYAplicarDosVecesNoHaceNada() {
        BaseJdbc().use { b ->
            assertEquals(Migraciones.VERSION, Migraciones.aplicar(b))
            assertEquals(Migraciones.VERSION.toLong(), version(b))
            val tablas = b.consultar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map { it[0] }
            assertTrue(tablas.containsAll(listOf("entity", "entity_field", "entity_tombstone", "op", "trip_closed_interval")))
            Migraciones.aplicar(b)
            assertEquals(Migraciones.VERSION.toLong(), version(b))
        }
    }

    @Test
    fun unaBaseConDatosDeLaVersion1PasaALa2SinPerderNadaYConLaColaEnSusValoresIniciales() {
        BaseJdbc().use { b ->
            // solo la migración 1, a mano, y una operación guardada con ella
            b.transaccion {
                Migraciones.TODAS[0].forEach { b.ejecutar(it) }
                b.ejecutar("PRAGMA user_version = 1")
            }
            b.ejecutar("INSERT INTO op (trip_id, op_id, seq, entity_type, entity_id, type, hlc, payload, schema_version) VALUES ('v','o1',1,'expense','e1','expense.update','h1','{}',1)")
            assertEquals(Migraciones.VERSION, Migraciones.aplicar(b))
            val o = AlmacenSqlite(b, "v").buscarEnCola("o1")!!
            assertEquals(listOf("CONFIRMADA", null, 0, null), listOf(o.estado.name, o.serverSeq, o.intentos, o.dependeDe))
            assertEquals(null, AlmacenSqlite(b, "v").viajeLocal())
        }
    }

    @Test
    fun unaBaseConUnEsquemaMasNuevoSeRechazaSinTocarla() {
        BaseJdbc().use { b ->
            b.ejecutar("PRAGMA user_version = ${Migraciones.VERSION + 1}")
            assertThrows(Migraciones.BaseMasNuevaError::class.java) { Migraciones.aplicar(b) }
            assertEquals((Migraciones.VERSION + 1).toLong(), version(b))
            assertFalse(b.consultar("SELECT name FROM sqlite_master WHERE name = 'entity'").isNotEmpty())
        }
    }

    @Test
    fun unaBaseEnArchivoSeReabreSinRepetirMigraciones() {
        val f = File.createTempFile("cdg", ".db").apply { deleteOnExit() }
        BaseJdbc("jdbc:sqlite:${f.path}").use { b ->
            Migraciones.aplicar(b)
            AlmacenSqlite(b, "v").crearEntidad("trip", "v1")
        }
        BaseJdbc("jdbc:sqlite:${f.path}").use { b ->
            Migraciones.aplicar(b)
            assertEquals("v1", AlmacenSqlite(b, "v").idDelViaje())
        }
    }

    @Test
    fun laBaseImponeSusReglasAunqueElCodigoFalle() {
        BaseJdbc().use { b ->
            Migraciones.aplicar(b)
            // redactada con payload
            assertThrows(Exception::class.java) { b.ejecutar("INSERT INTO op (trip_id, op_id, seq, entity_type, entity_id, type, hlc, payload, redactada, schema_version) VALUES ('v','o',1,'e','i','t','h','{}',1,1)") }
            // dos operaciones del mismo viaje con la misma secuencia
            b.ejecutar("INSERT INTO op (trip_id, op_id, seq, entity_type, entity_id, type, hlc, payload, schema_version) VALUES ('v','o1',1,'e','i','t','h1','{}',1)")
            assertThrows(Exception::class.java) { b.ejecutar("INSERT INTO op (trip_id, op_id, seq, entity_type, entity_id, type, hlc, payload, schema_version) VALUES ('v','o2',1,'e','i','t','h2','{}',1)") }
            b.ejecutar("INSERT INTO trip_closed_interval (trip_id, desde_ms, causa) VALUES ('v', 1, 'MANUAL')")
            assertThrows(Exception::class.java) { b.ejecutar("INSERT INTO trip_closed_interval (trip_id, desde_ms, causa) VALUES ('v', 5, 'MANUAL')") }
            assertThrows(Exception::class.java) { b.ejecutar("INSERT INTO trip_closed_interval (trip_id, desde_ms, hasta_ms, causa) VALUES ('w', 5, 5, 'FECHAS')") }
            assertThrows(Exception::class.java) { b.ejecutar("INSERT INTO trip_closed_interval (trip_id, desde_ms, causa) VALUES ('w', 5, 'OTRA')") }
            // la cola: estado conocido, secuencia del servidor única por viaje, intentos no negativos
            assertThrows(Exception::class.java) { b.ejecutar("UPDATE op SET estado = 'OTRO' WHERE op_id = 'o1'") }
            b.ejecutar("UPDATE op SET server_seq = 4 WHERE op_id = 'o1'")
            b.ejecutar("INSERT INTO op (trip_id, op_id, seq, entity_type, entity_id, type, hlc, payload, schema_version) VALUES ('v','o3',3,'e','i','t','h3','{}',1)")
            assertThrows(Exception::class.java) { b.ejecutar("UPDATE op SET server_seq = 4 WHERE op_id = 'o3'") }
            assertThrows(Exception::class.java) { b.ejecutar("UPDATE op SET intentos = -1 WHERE op_id = 'o3'") }
            assertThrows(Exception::class.java) { b.ejecutar("UPDATE op SET server_seq = 0 WHERE op_id = 'o3'") }
        }
    }

    @Test
    fun elSqlNoUsaNadaQueFalteEnLaSqliteDeAndroid8() {
        // Android 8 (la versión mínima) trae SQLite 3.18: sin UPSERT (3.24), columnas generadas (3.31), STRICT (3.37),
        // RETURNING (3.35), funciones JSON, RENAME COLUMN y funciones de ventana (3.25), NULLS FIRST y FILTER (3.30) ni iif (3.32)
        val prohibido = Regex("(?i)\\bON\\s+CONFLICT\\b[^;]*\\bDO\\b|\\bGENERATED\\b|\\bSTRICT\\b|\\bRETURNING\\b|\\bjson_|->>|\\bRENAME\\s+COLUMN\\b|\\bDROP\\s+COLUMN\\b|\\bOVER\\s*\\(|\\bNULLS\\s+(FIRST|LAST)\\b|\\bFILTER\\s*\\(\\s*WHERE|\\biif\\s*\\(")
        val fuentes = File(System.getProperty("fuentes.dir")).walk().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue(fuentes.isNotEmpty())
        for (f in fuentes) {
            val sinComentarios = f.readLines().filterNot { it.trim().startsWith("//") || it.trim().startsWith("--") || it.trim().startsWith("*") }.joinToString("\n")
            assertFalse("${f.name}: ${prohibido.find(sinComentarios)?.value}", prohibido.containsMatchIn(sinComentarios))
        }
    }
}
