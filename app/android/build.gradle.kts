// La app Android: pantallas y adaptadores. El dominio y la base local son módulos aparte, sin Android.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
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
    }

    buildFeatures {
        compose = true
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
        release {
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

    sourceSets["main"].kotlin.srcDirs("src/main/kotlin")
    sourceSets["test"].kotlin.srcDirs("src/test/kotlin")
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
    implementation(project(":dominio"))
    implementation(project(":datos"))

    testImplementation("junit:junit:4.13.2")
    // el SQLite de Android en la JVM: el adaptador de la base corre el mismo contrato que memoria y sqlite-jdbc
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation(testFixtures(project(":dominio")))
}
