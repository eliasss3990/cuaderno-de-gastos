package com.eliasgonzalez.cuadernodegastos.sesion

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.GeneralSecurityException
import javax.crypto.AEADBadTagException

/** Un cifrador de prueba (Robolectric no trae el Keystore de Android): suma 1 a cada byte y marca el principio. */
private class CifradorDePrueba(private val marca: Byte = 7) : Cifrador {
    override fun cifrar(claro: ByteArray) = byteArrayOf(marca) + claro.map { (it + 1).toByte() }

    override fun descifrar(cifrado: ByteArray): ByteArray {
        if (cifrado.firstOrNull() != marca) throw AEADBadTagException("otra clave")
        return cifrado.drop(1).map { (it - 1).toByte() }.toByteArray()
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TokensTest {
    private val prefs = ApplicationProvider.getApplicationContext<Context>().getSharedPreferences(Tokens.ARCHIVO, Context.MODE_PRIVATE)

    @Test
    fun guardaCifradoYLoDevuelve() {
        val t = Tokens(prefs, CifradorDePrueba())
        t.guardar("v1", "secreto-ñ")
        t.guardar("v2", "otro")
        assertEquals("secreto-ñ", t.leer("v1"))
        assertEquals("otro", t.leer("v2"))
        // lo guardado no es el token en claro
        assertFalse(prefs.all.values.any { "secreto" in it.toString() })
    }

    @Test
    fun sinTokenOConOtraClaveEsNull() {
        assertNull(Tokens(prefs, CifradorDePrueba()).leer("v1"))
        Tokens(prefs, CifradorDePrueba()).guardar("v1", "secreto")
        assertNull(Tokens(prefs, CifradorDePrueba(marca = 9)).leer("v1"))
        // un valor que ni siquiera es base64
        prefs.edit().putString("token.v1", "A").commit()
        assertNull(Tokens(prefs, CifradorDePrueba()).leer("v1"))
    }

    @Test
    fun elArchivoDeLosTokensEsElQueSeExcluyeDeLaTransferencia() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val xml = ctx.resources.getXml(com.eliasgonzalez.cuadernodegastos.R.xml.extraccion_de_datos)
        val excluidos = mutableListOf<Pair<String, String>>()
        while (xml.next() != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
            if (xml.eventType == org.xmlpull.v1.XmlPullParser.START_TAG && xml.name == "exclude") {
                excluidos += xml.getAttributeValue(null, "domain") to xml.getAttributeValue(null, "path")
            }
        }
        // en la nube y en la transferencia entre celulares
        assertEquals(List(2) { "sharedpref" to "${Tokens.ARCHIVO}.xml" }, excluidos)
    }

    @Test
    fun borrarLoQuita() {
        val t = Tokens(prefs, CifradorDePrueba())
        t.guardar("v1", "secreto")
        t.borrar("v1")
        assertNull(t.leer("v1"))
    }

    @Test
    fun unaFallaDelCifradoAlGuardarSeAvisa() {
        val roto = object : Cifrador {
            override fun cifrar(claro: ByteArray): ByteArray = throw GeneralSecurityException("sin Keystore")

            override fun descifrar(cifrado: ByteArray): ByteArray = cifrado
        }
        try {
            Tokens(prefs, roto).guardar("v1", "secreto")
            error("debía fallar")
        } catch (_: GeneralSecurityException) {
        }
        assertNull(prefs.getString("token.v1", null))
    }
}
