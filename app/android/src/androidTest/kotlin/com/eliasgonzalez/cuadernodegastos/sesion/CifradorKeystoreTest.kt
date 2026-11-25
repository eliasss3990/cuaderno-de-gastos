package com.eliasgonzalez.cuadernodegastos.sesion

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.security.GeneralSecurityException
import java.security.KeyStore

/** En el celular: el Keystore de verdad cifra, descifra y detecta lo alterado o cifrado con otra clave. */
@RunWith(AndroidJUnit4::class)
class CifradorKeystoreTest {
    @After
    fun limpiar() {
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.run {
            listOf("prueba-a", "prueba-b", "prueba-c").forEach { deleteEntry(it) }
        }
    }

    @Test
    fun variosHilosQueCreanLaClaveALaVezUsanLaMisma() {
        val cifrados = java.util.Collections.synchronizedList(mutableListOf<ByteArray>())
        val hilos = (1..8).map { Thread { cifrados += CifradorKeystore("prueba-c").cifrar("x".toByteArray()) } }
        hilos.forEach { it.start() }
        hilos.forEach { it.join() }
        // todo lo cifrado se descifra con la clave que quedó
        cifrados.forEach { assertArrayEquals("x".toByteArray(), CifradorKeystore("prueba-c").descifrar(it)) }
    }

    @Test
    fun cifraYDescifraConLaClaveDelKeystore() {
        val c = CifradorKeystore("prueba-a")
        val claro = "token-ñ-😀".toByteArray()
        val cifrado = c.cifrar(claro)
        assertFalse(String(cifrado, Charsets.ISO_8859_1).contains("token"))
        assertArrayEquals(claro, c.descifrar(cifrado))
        // cada vez con otro vector inicial
        assertFalse(cifrado.contentEquals(c.cifrar(claro)))
        // la misma clave sigue ahí para otra instancia
        assertArrayEquals(claro, CifradorKeystore("prueba-a").descifrar(cifrado))
    }

    @Test
    fun loAlteradoOConOtraClaveNoSeDescifra() {
        val cifrado = CifradorKeystore("prueba-a").cifrar("x".toByteArray())
        cifrado[cifrado.size - 1] = (cifrado.last() + 1).toByte()
        assertThrows(GeneralSecurityException::class.java) { CifradorKeystore("prueba-a").descifrar(cifrado) }
        val deOtra = CifradorKeystore("prueba-b").cifrar("x".toByteArray())
        assertThrows(GeneralSecurityException::class.java) { CifradorKeystore("prueba-a").descifrar(deOtra) }
    }
}
