package com.eliasgonzalez.cuadernodegastos

import org.junit.Assert.assertEquals
import org.junit.Test

class ArranqueTest {
    @Test
    fun elIdentificadorDeLaAppEsElEsperado() {
        assertEquals("com.eliasgonzalez.cuadernodegastos", MainActivity::class.java.packageName)
    }
}
