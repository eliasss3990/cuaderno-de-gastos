// Base local de la app sobre SQLite, sin Android: el SQL, las migraciones y el almacén de operaciones. Habla con la base
// por un puerto mínimo (`BaseSql`): en la app lo implementa el SQLite de Android, en las pruebas sqlite-jdbc.
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

val vectores = rootDir.parentFile.resolve("conformance")
tasks.test {
    inputs.dir(vectores).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("conformance.dir", vectores.path)
    systemProperty("fuentes.dir", file("src/main/kotlin").path)
}

dependencies {
    api(project(":dominio"))
    testImplementation("junit:junit:4.13.2")
    testImplementation(testFixtures(project(":dominio")))
    testImplementation("org.xerial:sqlite-jdbc:3.53.4.0")
}
