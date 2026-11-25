// El token de cada viaje, guardado cifrado con una clave del Keystore de Android (no sale del celular ni se puede leer
// sin él). Si la clave no está (otro celular, datos restaurados) el token no se puede leer y hay que volver a vincular.
package com.eliasgonzalez.cuadernodegastos.sesion

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Cifra y descifra bytes; descifrar lanza si no se puede (clave perdida o datos alterados). */
interface Cifrador {
    fun cifrar(claro: ByteArray): ByteArray

    fun descifrar(cifrado: ByteArray): ByteArray
}

/** AES-GCM con una clave que vive en el Keystore de Android. Lo cifrado lleva adelante el vector inicial. */
class CifradorKeystore(private val alias: String = "tokens-de-viajes") : Cifrador {
    private companion object {
        /** Generar con un alias que ya existe reemplaza la clave: dos hilos a la vez dejarían ilegible lo cifrado. */
        val generando = Any()
    }

    private fun clave(): SecretKey = synchronized(generando) {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    override fun cifrar(claro: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, clave()) }
        return c.iv + c.doFinal(claro)
    }

    override fun descifrar(cifrado: ByteArray): ByteArray {
        require(cifrado.size > 12) { "cifrado demasiado corto" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, clave(), GCMParameterSpec(128, cifrado, 0, 12))
        return c.doFinal(cifrado, 12, cifrado.size - 12)
    }
}

/** Escribe en disco: llamar fuera del hilo principal. */
class Tokens(private val prefs: SharedPreferences, private val cifrador: Cifrador) {
    companion object {
        /** El archivo de preferencias de los tokens (excluido de respaldos y de la transferencia entre celulares). */
        const val ARCHIVO = "tokens"
    }

    private fun clave(viaje: String) = "token.$viaje"

    fun guardar(viaje: String, token: String) {
        val cifrado = Base64.encodeToString(cifrador.cifrar(token.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        // commit y no apply: el token tiene que estar escrito antes de seguir (si la app muere, se perdería el vínculo)
        check(prefs.edit().putString(clave(viaje), cifrado).commit()) { "no se pudo guardar el token" }
    }

    /** El token del viaje, o null si no hay o no se puede leer (entonces hay que volver a vincular). */
    fun leer(viaje: String): String? {
        val guardado = prefs.getString(clave(viaje), null) ?: return null
        return try {
            cifrador.descifrar(Base64.decode(guardado, Base64.NO_WRAP)).toString(Charsets.UTF_8)
        } catch (_: GeneralSecurityException) {
            null
        } catch (_: java.security.ProviderException) {
            null // algunos fabricantes la tiran desde el Keystore en vez de una GeneralSecurityException
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    fun borrar(viaje: String) {
        check(prefs.edit().remove(clave(viaje)).commit()) { "no se pudo borrar el token" }
    }
}
