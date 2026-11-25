// Dominio de la app en Kotlin puro (sin Android): dinero, reloj, reglas de las operaciones. Se prueba en la JVM contra los
// mismos vectores de conformidad que el servidor (`../../conformance/`).
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

// los vectores viven fuera del módulo: como entrada, un cambio en ellos vuelve a correr las pruebas
val vectores = rootDir.parentFile.resolve("conformance")
tasks.test {
    inputs.dir(vectores).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("conformance.dir", vectores.path)
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    // las operaciones llevan su payload como JSON (JsonObject)
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.13.0")
}
