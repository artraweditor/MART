plugins {
    id("com.android.application")
}

android {
    namespace = "us.pixls.mart"
    compileSdk = 37
    defaultConfig {
        applicationId = "us.pixls.mart"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
        ndk { abiFilters += "arm64-v8a" }
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    packaging {
        // libART.so is dlopen()ed by the host with its path: it must be extracted to nativeLibraryDir
        jniLibs { useLegacyPackaging = true }
    }
}
