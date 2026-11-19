# iOS platform definitions for native/build-deps.sh and native/build-libart.sh (sourced).
# Needs: NATIVE, SLICE (device|simulator). Outputs go to ios/deps (prefix, build, logs) and ios/build.
ROOT=$(dirname "$NATIVE")/ios
DEPS=$ROOT/deps
TOOLCHAIN=$DEPS/toolchain-ios.cmake
export IOS_SLICE=$SLICE
PLATFORM_CMAKE_ARGS=(-DIOS_SLICE=$SLICE)
ALL=(zlib png jpeg tiff expat lcms fftw ffi pcre2 glib sigc glibmm lensfun exiv2 omp libraw imath deflate openexr ctl yamlcpp pystring minizip ocio)
HOST_TRIPLE=aarch64-apple-darwin
MESON_OBJC=1
MESON_LINK_EXTRA=
MESON_HOST_MACHINE=

platform_setup() {
  if [ "$SLICE" = simulator ]; then SDK=iphonesimulator; TGT=arm64-apple-ios16.0-simulator
  else SDK=iphoneos; TGT=arm64-apple-ios16.0; fi
  SYSROOT=$(xcrun --sdk $SDK --show-sdk-path)
  CC_BIN=$(xcrun --sdk $SDK -f clang); CXX_BIN=$(xcrun --sdk $SDK -f clang++)
  AR_BIN=$(xcrun --sdk $SDK -f ar); RANLIB_BIN=$(xcrun --sdk $SDK -f ranlib)
  STRIP_BIN=$(xcrun --sdk $SDK -f strip)
  CC_EXTRA="-target $TGT -isysroot $SYSROOT"
  CFLAGS_ALL="-target $TGT -isysroot $SYSROOT -fPIC -O2 -I$PREFIX/include"
  LDFLAGS_ALL="-target $TGT -isysroot $SYSROOT -L$PREFIX/lib"
  OMPF="-Xpreprocessor -fopenmp -I$PREFIX/include"   # Apple clang: libomp is a separate (static) library
  MESON_HOST_MACHINE="system = 'darwin'
subsystem = '$([ $SLICE = simulator ] && echo ios-simulator || echo ios)'
cpu_family = 'aarch64'
cpu = 'arm64'
endian = 'little'"
}

platform_ffi_fixup() {
  find $BUILD/libffi -name fficonfig.h -exec sed -i '' 's|^#define HAVE_AS_CFI_PSEUDO_OP 1|/* #undef HAVE_AS_CFI_PSEUDO_OP */|' {} +
}

step_omp()   { local B=$BUILD/libomp; rm -rf $B
  cmake -S $SRC/llvm-openmp/runtimes -B $B "${CMAKE_COMMON[@]}" -DLLVM_ENABLE_RUNTIMES=openmp -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_DOCS=OFF \
    -DLIBOMP_ENABLE_SHARED=OFF -DLIBOMP_OMPT_SUPPORT=OFF -DLIBOMP_USE_HWLOC=OFF -DLIBOMP_FORTRAN_MODULES=OFF \
    -DOPENMP_ENABLE_LIBOMPTARGET=OFF -DLIBOMP_INSTALL_ALIASES=OFF && ninja -C $B omp \
  && mkdir -p $PREFIX/include && cp $B/openmp/runtime/src/libomp.a $PREFIX/lib/ && cp $B/openmp/runtime/src/omp.h $PREFIX/include/; }

# --- libART (native/build-libart.sh) ---
LIBART_NEEDS_OMP_FLAGS=1
platform_libart_setup() {   # P = the prefix lib dir
  # the static dependencies that the .pc files of OpenColorIO, OpenEXR and CTL do not list
  STATICDEPS="-lOpenEXR-3_2 -lOpenEXRCore-3_2 -lIlmThread-3_2 -lIex-3_2 -lImath-3_2 -ldeflate -lyaml-cpp -lpystring -lminizip -lcompression -lz -lexpat"
  # glib's constructors (glib_init, gobject init) must run before the C++ static initializers
  # of the engine, which use GLib (the order follows the link order of the objects in the dylib).
  LIBART_LDFLAGS="-Wl,-force_load,$P/libglib-2.0.a -Wl,-force_load,$P/libgobject-2.0.a"
}
