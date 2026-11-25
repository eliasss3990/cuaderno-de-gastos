// Cliente HTTP del servidor, sin Android (HttpURLConnection existe en la JVM y en Android): implementa el puerto del
// ciclo de sincronización y se prueba en la JVM contra un servidor HTTP de prueba.
plugins {
    `java-library`
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":dominio"))
    testImplementation("junit:junit:4.13.2")
}

// la prueba contra el servidor real corre solo si se le pasa su dirección: -PservidorDePrueba=http://…
tasks.test {
    systemProperty("servidor.de.prueba", (findProperty("servidorDePrueba") ?: "").toString())
}
