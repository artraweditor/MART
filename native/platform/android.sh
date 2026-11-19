# Android platform definitions for native/build-deps.sh and native/build-libart.sh (sourced).
# Needs: NATIVE, SLICE (arm64). Outputs go to android/deps (prefix, build, logs) and android/build.
# NDK: $ANDROID_NDK_HOME (default: the Homebrew cask), API level 26 (Android 8.0).
ROOT=$(dirname "$NATIVE")/android
DEPS=$ROOT/deps
export ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-/opt/homebrew/share/android-ndk}
export ANDROID_SLICE=$SLICE
TOOLCHAIN=$DEPS/toolchain-android.cmake
PLATFORM_CMAKE_ARGS=()
ANDROID_API=26
ALL=(zlib png jpeg tiff expat lcms fftw ffi pcre2 iconv glib sigc glibmm lensfun exiv2 omp libraw imath deflate openexr ctl yamlcpp pystring minizip ocio)
HOST_TRIPLE=aarch64-linux-android
MESON_OBJC=
PAGE="-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384"
MESON_LINK_EXTRA=", '-Wl,-z,max-page-size=16384', '-Wl,-z,common-page-size=16384'"
MESON_HOST_MACHINE="system = 'android'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'"

platform_setup() {
  [ "$SLICE" = arm64 ] || { echo "android: the only slice is arm64"; exit 1; }
  NDKBIN=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin
  [ -x $NDKBIN/aarch64-linux-android$ANDROID_API-clang ] || { echo "NDK not found in $ANDROID_NDK_HOME"; exit 1; }
  NDKLIB=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/lib/clang
  NDKLIB=$NDKLIB/$(ls $NDKLIB | head -1)
  CC_BIN=$NDKBIN/aarch64-linux-android$ANDROID_API-clang; CXX_BIN=$NDKBIN/aarch64-linux-android$ANDROID_API-clang++
  AR_BIN=$NDKBIN/llvm-ar; RANLIB_BIN=$NDKBIN/llvm-ranlib; STRIP_BIN=$NDKBIN/llvm-strip
  CC_EXTRA=""                     # the NDK wrappers already carry -target and --sysroot
  CFLAGS_ALL="-fPIC -O2 -I$PREFIX/include"
  LDFLAGS_ALL="-L$PREFIX/lib $PAGE"
  OMPF="-fopenmp -I$PREFIX/include"
  AUTOTOOLS_EXTRA=(AR=$AR_BIN RANLIB=$RANLIB_BIN STRIP=$STRIP_BIN NM=$NDKBIN/llvm-nm)
  export PATH=$NDKBIN:$PATH       # llvm-nm, llvm-objdump, ... for configure scripts
}

platform_ffi_fixup() { :; }

# OpenMP: the NDK ships a static libomp.a for aarch64: copy it (and omp.h) into the prefix, so that
# the later steps and libART find it exactly as on iOS.
step_omp() { mkdir -p $PREFIX/include $PREFIX/lib && cp $NDKLIB/lib/linux/aarch64/libomp.a $PREFIX/lib/ && cp $NDKLIB/include/omp.h $PREFIX/include/; }

# bionic has iconv only from API 28: GNU libiconv (static) for glib
step_iconv() { [ -f $SRC/libiconv-$ICONV_V.tar.gz ] || curl -fL -o $SRC/libiconv-$ICONV_V.tar.gz $ICONV_URL
  autotools_dep libiconv libiconv-$ICONV_V.tar.gz --disable-nls; }

# --- libART (native/build-libart.sh) ---
platform_libart_setup() {   # P = the prefix lib dir
  STATICDEPS="-lOpenEXR-3_2 -lOpenEXRCore-3_2 -lIlmThread-3_2 -lIex-3_2 -lImath-3_2 -ldeflate -lyaml-cpp -lpystring -lminizip -lz -lexpat"
  # glib's constructors must run before the C++ static initializers of the engine (cf. ios.sh)
  LIBART_LDFLAGS="-Wl,--whole-archive $P/libglib-2.0.a $P/libgobject-2.0.a -Wl,--no-whole-archive -static-openmp $PAGE"
}
