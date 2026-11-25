package com.eliasgonzalez.cuadernodegastos.ayudas

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File

/** Los vectores de conformidad compartidos con el servidor (`conformance/` en la raíz del repositorio). */
object Vectores {
    // la ruta la pasa Gradle (build.gradle.kts del módulo), que además la declara como entrada de la prueba
    private val carpeta: File by lazy {
        val ruta = requireNotNull(System.getProperty("conformance.dir")) { "falta la propiedad conformance.dir" }
        File(ruta).also { require(it.isDirectory) { "no existe la carpeta de vectores $ruta" } }
    }

    fun leer(nombre: String): JsonObject = Json.parseToJsonElement(File(carpeta, nombre).readText()).jsonObject
}
