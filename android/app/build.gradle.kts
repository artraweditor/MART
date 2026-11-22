plugins {
    id("com.android.application")
}

// the version of the app is the one of the host (MART_VERSION: native/version.sh)
fun martVersion(mode: String): String {
    val script = rootDir.resolve("../native/version.sh").canonicalPath
    val p = ProcessBuilder("bash", script, *(if (mode.isEmpty()) arrayOf() else arrayOf(mode)))
        .redirectErrorStream(true).start()
    val out = p.inputStream.bufferedReader().readText().trim()
    check(p.waitFor() == 0) { "native/version.sh failed: $out" }
    return out
}

android {
    namespace = "us.pixls.mart"
    compileSdk = 37
    defaultConfig {
        applicationId = "us.pixls.mart"
        minSdk = 26
        targetSdk = 36
        versionCode = martVersion("code").toInt()
        versionName = martVersion("")
        ndk { abiFilters += "arm64-v8a" }
    }
    // a release is signed with the key of MART_KEYSTORE (MART_KEYSTORE_PASSWORD, MART_KEY_ALIAS,
    // MART_KEY_PASSWORD), if the environment has it: see .github/workflows/android.yml
    val keystore = System.getenv("MART_KEYSTORE")
    if (keystore != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("MART_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MART_KEY_ALIAS")
                keyPassword = System.getenv("MART_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    packaging {
        // libART.so is dlopen()ed by the host with its path: it must be extracted to nativeLibraryDir
        jniLibs { useLegacyPackaging = true }
    }
}
