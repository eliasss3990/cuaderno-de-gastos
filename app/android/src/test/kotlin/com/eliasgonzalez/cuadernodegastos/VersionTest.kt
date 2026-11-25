package com.eliasgonzalez.cuadernodegastos

import org.junit.Assert.assertEquals
import org.junit.Test

class VersionTest {
    @Test
    fun alServidorVaLaVersionSinElSufijoDeDesarrollo() {
        assertEquals("0.1.1", versionParaElServidor("0.1.1-debug"))
        assertEquals("0.1.1", versionParaElServidor("0.1.1"))
        assertEquals("1.20.3", versionParaElServidor("1.20.3-debug"))
        // caracterización: cualquier sufijo se quita (una versión preliminar se presentaría como la final)
        assertEquals("1.0.0", versionParaElServidor("1.0.0-rc.1"))
    }
}
