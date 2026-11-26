// La app Android: pantallas y adaptadores. El dominio y la base local son módulos aparte, sin Android.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    // capturas de las pantallas en la JVM (quedan en build/)
    id("io.github.takahirom.roborazzi")
}

// Firma de release leída de variables de entorno (las pone el CI desde los
// secretos de GitHub). Nunca se commitea un keystore ni sus contraseñas.
val releaseKeystorePath: String? = System.getenv("RELEASE_KEYSTORE_PATH")
val releaseKeystorePassword: String? = System.getenv("RELEASE_KEYSTORE_PASSWORD")
val releaseKeyAlias: String? = System.getenv("RELEASE_KEY_ALIAS")
val releaseKeyPassword: String? = System.getenv("RELEASE_KEY_PASSWORD")
val hasReleaseSigning = !releaseKeystorePath.isNullOrBlank()

android {
    namespace = "com.eliasgonzalez.cuadernodegastos"
    // Compose 1.13.0 (BOM 2026.11.01) exige compilar contra la API 37.1 o superior.
    compileSdk {
        version = release(37) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.eliasgonzalez.cuadernodegastos"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // el servidor del viaje; se puede cambiar al compilar con -PservidorDeLaApp=https://…
        buildConfigField("String", "SERVIDOR", "\"${findProperty("servidorDeLaApp") ?: "https://cuaderno.eliasg.uk"}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        // la de desarrollo convive con la publicada en el mismo celular (otro id, otros datos)
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // tiempos cortos para probar a mano sin esperar
            buildConfigField("long", "CIERRE_EN_SEGUNDO_PLANO_MS", "5000L")
            buildConfigField("long", "CONSULTA_DE_RESPALDO_MS", "10000L")
        }
        release {
            buildConfigField("long", "CIERRE_EN_SEGUNDO_PLANO_MS", "30000L")
            buildConfigField("long", "CONSULTA_DE_RESPALDO_MS", "60000L")
            isMinifyEnabled = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // las pruebas con Robolectric leen recursos de la app (las reglas de respaldo)
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    sourceSets["main"].kotlin.srcDirs("src/main/kotlin")
    sourceSets["test"].kotlin.srcDirs("src/test/kotlin")
    sourceSets["androidTest"].kotlin.srcDirs("src/androidTest/kotlin")
}

// El Android que usa Robolectric en las pruebas lo baja Gradle (con reintentos y su caché) en vez de Robolectric durante
// la prueba: una descarga cortada en medio de las pruebas rompía el CI. Robolectric corre sin red y lo toma de acá.
val androidDeRobolectric: Configuration by configurations.creating
dependencies {
    androidDeRobolectric("org.robolectric:android-all-instrumented:14-robolectric-10818077-i7")
}
val copiarAndroidDeRobolectric by tasks.registering(Sync::class) {
    from(androidDeRobolectric)
    into(layout.buildDirectory.dir("robolectric-android"))
}
tasks.withType<Test>().configureEach {
    dependsOn(copiarAndroidDeRobolectric)
    // un tope fijo: con las capturas de pantalla la JVM de las pruebas crece y en máquinas chicas mataba al demonio
    maxHeapSize = "768m"
    systemProperty("robolectric.offline", "true")
    systemProperty("robolectric.dependency.dir", layout.buildDirectory.dir("robolectric-android").get().asFile.absolutePath)
}

// el APK se sigue llamando cuaderno-de-gastos-*.apk, como antes de que la app pasara a su módulo
base {
    archivesName.set("cuaderno-de-gastos")
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation(platform("androidx.compose:compose-bom:2026.11.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.navigation:navigation-compose:2.10.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.1")
    // la sincronización periódica con la app cerrada y saber si la app está en pantalla
    implementation("androidx.work:work-runtime:2.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.11.1")
    implementation(project(":dominio"))
    implementation(project(":datos"))
    implementation(project(":red"))

    testImplementation("junit:junit:4.13.2")
    // el SQLite de Android en la JVM: el adaptador de la base corre el mismo contrato que memoria y sqlite-jdbc
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("androidx.work:work-testing:2.12.0")
    // capturas de cada pantalla en la JVM (Robolectric)
    testImplementation(platform("androidx.compose:compose-bom:2026.11.01"))
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.79.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.79.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    // pruebas en el celular (lo que la JVM no tiene, como el Keystore): ./gradlew connectedDebugAndroidTest
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    testImplementation(testFixtures(project(":dominio")))
}
