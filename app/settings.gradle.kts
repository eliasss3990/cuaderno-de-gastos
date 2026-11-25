pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "cuaderno-de-gastos"

// la app Android
include(":android")

// dominio en Kotlin puro (sin Android), probado en la JVM
include(":dominio")

// base local sobre SQLite (sin Android), probada en la JVM contra una SQLite real
include(":datos")
