#!/bin/bash
# Build the static dependencies of libART for a platform (shared by iOS and Android).
# Usage: build-deps.sh <ios|android> <slice> [step ...]   (default: all steps of the platform)
#   ios: slice = device|simulator; android: slice = arm64
# What differs per platform (compilers, flags, meson/autotools host, extra steps) is in
# platform/<platform>.sh; the outputs go to <platform dir>/deps/{prefix,build,logs}/<slice>.
set -euo pipefail
unset LIBRARY_PATH CPATH
PLATFORM=${1:?usage: build-deps.sh ios|android slice [step...]}; SLICE=${2:?slice}; shift 2 || true
NATIVE=$(cd "$(dirname "$0")" && pwd)
. "$NATIVE/versions.sh"
. "$NATIVE/platform/$PLATFORM.sh"      # sets DEPS, compilers, flags, ALL, ...
PREFIX=$DEPS/prefix/$SLICE
BUILD=$DEPS/build/$SLICE
LOGS=$DEPS/logs/$SLICE
SRC=$NATIVE/src
mkdir -p "$PREFIX/lib/pkgconfig" "$BUILD" "$LOGS"
platform_setup                          # compilers/flags that depend on SLICE and PREFIX
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig PKG_CONFIG_PATH=
export PATH=/opt/homebrew/bin:$PATH

CMAKE_COMMON=(-G Ninja -DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN ${PLATFORM_CMAKE_ARGS[@]+"${PLATFORM_CMAKE_ARGS[@]}"} -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_INSTALL_PREFIX=$PREFIX -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5)

extract() { # name tarball
  local d=$BUILD/$1; rm -rf "$d"; mkdir -p "$d"; tar -xf "$SRC/$2" -C "$d" --strip-components=1
  local p; for p in "$NATIVE"/patches/$1-*.patch "$NATIVE"/patches/$PLATFORM/$1-*.patch; do [ -e "$p" ] && (cd "$d" && patch -p1 < "$p"); done || true
}
cmake_dep() { # name tarball extra-args...
  local n=$1 t=$2; shift 2; extract $n $t
  cmake -S $BUILD/$n -B $BUILD/$n/_b "${CMAKE_COMMON[@]}" "$@" && ninja -C $BUILD/$n/_b install
}

meson_cross() {
  local cc="'$CC_BIN'" cxx="'$CXX_BIN'" w
  for w in $CC_EXTRA; do cc="$cc, '$w'"; cxx="$cxx, '$w'"; done
  local objc=""; [ -n "${MESON_OBJC:-}" ] && objc="objc = [$cc]"
  local objc_args=""; [ -n "${MESON_OBJC:-}" ] && objc_args="objc_args = ['-fPIC', '-I$PREFIX/include']"
  { echo "[binaries]"
    echo "c = [$cc]"; echo "cpp = [$cxx]"; [ -n "$objc" ] && echo "$objc"
    echo "ar = '$AR_BIN'"; echo "ranlib = '$RANLIB_BIN'"; echo "strip = '$STRIP_BIN'"
    echo "pkg-config = '$(command -v pkg-config)'"
    echo "[built-in options]"
    echo "c_args = ['-fPIC', '-I$PREFIX/include']"; echo "cpp_args = ['-fPIC', '-I$PREFIX/include']"
    [ -n "$objc_args" ] && echo "$objc_args"
    echo "c_link_args = ['-L$PREFIX/lib'$MESON_LINK_EXTRA]"; echo "cpp_link_args = ['-L$PREFIX/lib'$MESON_LINK_EXTRA]"
    echo "default_library = 'static'"
    echo "[properties]"
    echo "needs_exe_wrapper = true"
    echo "pkg_config_libdir = '$PREFIX/lib/pkgconfig'"
    echo "[host_machine]"
    echo "$MESON_HOST_MACHINE"
  } > $BUILD/meson-cross.ini
}
meson_dep() { # name tarball extra-args...
  local n=$1 t=$2; shift 2; extract $n $t; meson_cross
  meson setup $BUILD/$n/_b $BUILD/$n --cross-file $BUILD/meson-cross.ini --prefix $PREFIX \
    --libdir lib --buildtype release --default-library static "$@" && ninja -C $BUILD/$n/_b install
}
autotools_dep() { # name tarball extra-args...
  local n=$1 t=$2; shift 2; extract $n $t
  (cd $BUILD/$n && ./configure --host=$HOST_TRIPLE --prefix=$PREFIX --disable-shared --enable-static \
    CC="$CC_BIN $CC_EXTRA" CFLAGS="$CFLAGS_ALL" LDFLAGS="$LDFLAGS_ALL" ${AUTOTOOLS_EXTRA[@]+"${AUTOTOOLS_EXTRA[@]}"} "$@" \
    && make -j8 && make install)
}

step_zlib()  { cmake_dep zlib zlib-$ZLIB_V.tar.gz -DZLIB_BUILD_EXAMPLES=OFF; rm -f $PREFIX/lib/libz.dylib $PREFIX/lib/libz*.dylib $PREFIX/lib/libz.so*; }
step_png()   { cmake_dep libpng libpng-$PNG_V.tar.xz -DPNG_SHARED=OFF -DPNG_STATIC=ON -DPNG_TESTS=OFF -DPNG_TOOLS=OFF -DPNG_FRAMEWORK=OFF -DPNG_ARM_NEON=on -DZLIB_ROOT=$PREFIX; }
step_jpeg()  { cmake_dep libjpeg-turbo libjpeg-turbo-$JPEG_V.tar.gz -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DWITH_TURBOJPEG=OFF -DWITH_JAVA=OFF -DWITH_TOOLS=OFF -DWITH_TESTS=OFF; }
step_tiff()  { cmake_dep tiff tiff-$TIFF_V.tar.gz -Dtiff-tools=OFF -Dtiff-tests=OFF -Dtiff-contrib=OFF -Dtiff-docs=OFF \
                 -Dlzma=OFF -Dzstd=OFF -Dwebp=OFF -Djbig=OFF -Dlerc=OFF -Dlibdeflate=OFF -Dcxx=OFF -Dpixarlog=OFF -DCMAKE_DISABLE_FIND_PACKAGE_OpenGL=ON; }
step_expat() { cmake_dep expat expat-$EXPAT_V.tar.xz -DEXPAT_BUILD_TOOLS=OFF -DEXPAT_BUILD_EXAMPLES=OFF -DEXPAT_BUILD_TESTS=OFF -DEXPAT_BUILD_DOCS=OFF -DEXPAT_SHARED_LIBS=OFF; }
step_lcms()  { meson_dep lcms2 lcms2-$LCMS_V.tar.gz -Djpeg=disabled -Dtiff=disabled -Dutils=false -Dsamples=false -Dfastfloat=false -Dthreaded=false; }
step_fftw()  { autotools_dep fftw fftw-$FFTW_V.tar.gz --enable-single --enable-neon --disable-fortran --disable-doc --enable-threads --with-combined-threads; }
# libffi: on Apple the arm64 assembler rejects the CFI macros of sysv.S ("invalid CFI advance_loc
# expression"); platform_ffi_fixup (platform/ios.sh) turns CFI off after configure.
step_ffi()   { extract libffi libffi-$FFI_V.tar.gz; (cd $BUILD/libffi && ./configure --host=$HOST_TRIPLE --prefix=$PREFIX \
    --disable-shared --enable-static --disable-docs --disable-multi-os-directory \
    CC="$CC_BIN $CC_EXTRA" CFLAGS="$CFLAGS_ALL" LDFLAGS="$LDFLAGS_ALL" ${AUTOTOOLS_EXTRA[@]+"${AUTOTOOLS_EXTRA[@]}"} \
    ; platform_ffi_fixup; \
    cd $BUILD/libffi && make -j8 && make install); }
step_pcre2() { cmake_dep pcre2 pcre2-$PCRE2_V.tar.bz2 -DPCRE2_BUILD_PCRE2GREP=OFF -DPCRE2_BUILD_TESTS=OFF -DPCRE2_SUPPORT_JIT=OFF -DPCRE2_BUILD_PCRE2_8=ON; }
step_glib()  { meson_dep glib glib-$GLIB_V.tar.xz -Dtests=false -Dnls=disabled -Dlibmount=disabled -Dselinux=disabled \
                 -Dinstalled_tests=false -Dman=false -Dxattr=false -Dlibelf=disabled -Dglib_debug=disabled -Dsysprof=disabled ${GLIB_EXTRA[@]+"${GLIB_EXTRA[@]}"}; }
step_sigc()  { meson_dep libsigc++ libsigc++-$SIGC_V.tar.xz -Dbuild-documentation=false -Dbuild-examples=false -Dbuild-tests=false -Dbuild-pdf=false; }
step_glibmm(){ meson_dep glibmm glibmm-$GLIBMM_V.tar.xz -Dbuild-documentation=false -Dbuild-examples=false; }
step_lensfun(){ cmake_dep lensfun lensfun-$LENSFUN_V.tar.gz -DBUILD_STATIC=ON -DBUILD_TESTS=OFF -DBUILD_LENSTOOL=OFF -DBUILD_DOC=OFF -DBUILD_AUXFUN=OFF -DPYTHON=PYTHON-NOTFOUND -DINSTALL_PYTHON_MODULE=OFF -DINSTALL_HELPER_SCRIPTS=OFF; }
step_exiv2() { cmake_dep exiv2 exiv2-$EXIV2_V.tar.gz -DEXIV2_ENABLE_SHARED=OFF -DEXIV2_ENABLE_XMP=ON -DEXIV2_ENABLE_EXTERNAL_XMP=OFF \
                 -DEXIV2_ENABLE_NLS=OFF -DEXIV2_ENABLE_WEBREADY=OFF -DEXIV2_ENABLE_BROTLI=OFF -DEXIV2_ENABLE_INIH=OFF \
                 -DEXIV2_ENABLE_VIDEO=OFF -DEXIV2_ENABLE_CURL=OFF -DEXIV2_BUILD_SAMPLES=OFF -DEXIV2_BUILD_EXIV2_COMMAND=OFF \
                 -DEXIV2_BUILD_UNIT_TESTS=OFF -DEXIV2_BUILD_DOC=OFF -DEXIV2_ENABLE_BMFF=ON; }
step_libraw(){ local n=libraw; rm -rf $BUILD/$n; cmake -S ${LIBRAW_SRC:-$HOME/src/LibRaw} -B $BUILD/$n "${CMAKE_COMMON[@]}" \
                 -DENABLE_OPENMP=ON "-DOpenMP_C_FLAGS=$OMPF" "-DOpenMP_CXX_FLAGS=$OMPF" -DOpenMP_C_LIB_NAMES=omp -DOpenMP_CXX_LIB_NAMES=omp -DOpenMP_omp_LIBRARY=$PREFIX/lib/libomp.a -DENABLE_LCMS=OFF -DENABLE_EXAMPLES=OFF -DENABLE_RAWSPEED=OFF -DENABLE_DCRAW_DEBUG=OFF \
                 -DENABLE_X3FTOOLS=OFF -DMATH_LIBRARY=-lm 2>&1 && ninja -C $BUILD/$n install; }

# step_omp is platform specific (platform/<platform>.sh)
step_imath() { cmake_dep Imath imath-$IMATH_V.tar.gz -DBUILD_TESTING=OFF -DIMATH_INSTALL_PKG_CONFIG=ON -DPYTHON=OFF; }
step_deflate(){ cmake_dep libdeflate libdeflate-$DEFLATE_V.tar.gz -DLIBDEFLATE_BUILD_SHARED_LIB=OFF -DLIBDEFLATE_BUILD_STATIC_LIB=ON -DLIBDEFLATE_BUILD_GZIP=OFF; }
step_openexr(){ cmake_dep openexr openexr-$OPENEXR_V.tar.gz -DBUILD_TESTING=OFF -DOPENEXR_BUILD_TOOLS=OFF -DOPENEXR_BUILD_EXAMPLES=OFF \
                 -DOPENEXR_INSTALL_TOOLS=OFF -DOPENEXR_BUILD_PYTHON=OFF -DOPENEXR_INSTALL_PKG_CONFIG=ON -DOPENEXR_FORCE_INTERNAL_IMATH=OFF \
                 -DOPENEXR_FORCE_INTERNAL_DEFLATE=OFF -DOPENEXR_FORCE_INTERNAL_OPENJPH=OFF -DOPENEXR_ENABLE_THREADING=ON -DOPENEXR_BUILD_UTILS=OFF -DImath_DIR=$PREFIX/lib/cmake/Imath; }
step_ctl()   { cmake_dep CTL ctl-$CTL_V.tar.gz -DCTL_BUILD_TESTS=OFF -DCTL_BUILD_TOOLS=OFF -DBUILD_TESTING=OFF -DCTL_BUILD_SHARED_LIBS=OFF; }
step_yamlcpp(){ cmake_dep yaml-cpp yaml-cpp-$YAMLCPP_V.tar.gz -DYAML_CPP_BUILD_TESTS=OFF -DYAML_CPP_BUILD_TOOLS=OFF -DYAML_CPP_BUILD_CONTRIB=OFF -DYAML_BUILD_SHARED_LIBS=OFF; }
step_pystring(){ extract pystring pystring-$PYSTRING_V.tar.gz
  cat > $BUILD/pystring/CMakeLists.txt <<'EOT'
cmake_minimum_required(VERSION 3.5)
project(pystring CXX)
add_library(pystring STATIC pystring.cpp)
target_include_directories(pystring PUBLIC $<INSTALL_INTERFACE:include>)
install(TARGETS pystring ARCHIVE DESTINATION lib)
install(FILES pystring.h DESTINATION include/pystring)
EOT
  cmake -S $BUILD/pystring -B $BUILD/pystring/_b "${CMAKE_COMMON[@]}" && ninja -C $BUILD/pystring/_b install; }
step_minizip(){ cmake_dep minizip-ng minizip-ng-$MINIZIP_V.tar.gz -DMZ_COMPAT=ON -DMZ_ZLIB=ON -DMZ_BZIP2=OFF -DMZ_LZMA=OFF -DMZ_ZSTD=OFF -DMZ_PKCRYPT=OFF -DMZ_WZAES=OFF \
                 -DMZ_OPENSSL=OFF -DMZ_LIBBSD=OFF -DMZ_ICONV=OFF -DMZ_FETCH_LIBS=OFF -DMZ_FORCE_FETCH_LIBS=OFF -DMZ_SIGNING=OFF -DMZ_BUILD_TESTS=OFF -DMZ_BUILD_UNIT_TESTS=OFF; }
step_ocio()  { cmake_dep OpenColorIO OpenColorIO-$OCIO_V.tar.gz -DOCIO_BUILD_APPS=OFF -DOCIO_BUILD_OPENFX=OFF -DOCIO_BUILD_PYTHON=OFF -DOCIO_BUILD_DOCS=OFF \
                 -DOCIO_BUILD_TESTS=OFF -DOCIO_BUILD_GPU_TESTS=OFF -DOCIO_INSTALL_EXT_PACKAGES=NONE -DOCIO_USE_SIMD=ON -DOCIO_BUILD_JAVA=OFF \
                 -DBUILD_SHARED_LIBS=OFF -DOCIO_WARNING_AS_ERROR=OFF; }

# ALL (the default steps and their order) comes from platform/<platform>.sh
STEPS=("$@"); [ ${#STEPS[@]} -eq 0 ] && STEPS=("${ALL[@]}")
for s in "${STEPS[@]}"; do
  echo "== [$PLATFORM $SLICE] $s"
  if ! ( "step_$s" ) > "$LOGS/$s.log" 2>&1; then echo "FAILED: $s (see $LOGS/$s.log)"; tail -25 "$LOGS/$s.log"; exit 1; fi
  touch "$PREFIX/.done-$s"
done
echo "all requested steps done"
