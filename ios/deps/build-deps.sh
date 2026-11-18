#!/bin/bash
# Build the static dependencies of libART for iOS.
# Usage: build-deps.sh <device|simulator> [step ...]   (default: all steps)
set -euo pipefail
unset LIBRARY_PATH CPATH
SLICE=${1:?usage: build-deps.sh device|simulator [step...]}; shift || true
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/versions.sh"
PREFIX=$HERE/prefix/$SLICE
BUILD=$HERE/build/$SLICE
LOGS=$HERE/logs/$SLICE
SRC=$HERE/src
mkdir -p "$PREFIX/lib/pkgconfig" "$BUILD" "$LOGS"
export IOS_SLICE=$SLICE
if [ "$SLICE" = simulator ]; then SDK=iphonesimulator; TGT=arm64-apple-ios16.0-simulator
else SDK=iphoneos; TGT=arm64-apple-ios16.0; fi
SYSROOT=$(xcrun --sdk $SDK --show-sdk-path)
CC_BIN=$(xcrun --sdk $SDK -f clang); CXX_BIN=$(xcrun --sdk $SDK -f clang++)
AR_BIN=$(xcrun --sdk $SDK -f ar); RANLIB_BIN=$(xcrun --sdk $SDK -f ranlib)
STRIP_BIN=$(xcrun --sdk $SDK -f strip)
CFLAGS_ALL="-target $TGT -isysroot $SYSROOT -fPIC -O2 -I$PREFIX/include"
LDFLAGS_ALL="-target $TGT -isysroot $SYSROOT -L$PREFIX/lib"
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig PKG_CONFIG_PATH=
export PATH=/opt/homebrew/bin:$PATH
TOOLCHAIN=$HERE/toolchain-ios.cmake
OMPF="-Xpreprocessor -fopenmp -I$PREFIX/include"   # Apple clang: libomp is a separate (static) library

CMAKE_COMMON=(-G Ninja -DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN -DIOS_SLICE=$SLICE -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_INSTALL_PREFIX=$PREFIX -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5)

extract() { # name tarball
  local d=$BUILD/$1; rm -rf "$d"; mkdir -p "$d"; tar -xf "$SRC/$2" -C "$d" --strip-components=1
  local p; for p in "$HERE"/patches/$1-*.patch; do [ -e "$p" ] && (cd "$d" && patch -p1 < "$p"); done || true
}
cmake_dep() { # name tarball extra-args...
  local n=$1 t=$2; shift 2; extract $n $t
  cmake -S $BUILD/$n -B $BUILD/$n/_b "${CMAKE_COMMON[@]}" "$@" && ninja -C $BUILD/$n/_b install
}

meson_cross() {
  cat > $BUILD/meson-cross.ini <<EOT
[binaries]
c = ['$CC_BIN', '-target', '$TGT', '-isysroot', '$SYSROOT']
cpp = ['$CXX_BIN', '-target', '$TGT', '-isysroot', '$SYSROOT']
objc = ['$CC_BIN', '-target', '$TGT', '-isysroot', '$SYSROOT']
ar = '$AR_BIN'
ranlib = '$RANLIB_BIN'
strip = '$STRIP_BIN'
pkg-config = '/opt/homebrew/bin/pkg-config'
[built-in options]
c_args = ['-fPIC', '-I$PREFIX/include']
cpp_args = ['-fPIC', '-I$PREFIX/include']
objc_args = ['-fPIC', '-I$PREFIX/include']
c_link_args = ['-L$PREFIX/lib']
cpp_link_args = ['-L$PREFIX/lib']
default_library = 'static'
[properties]
needs_exe_wrapper = true
pkg_config_libdir = '$PREFIX/lib/pkgconfig'
[host_machine]
system = 'darwin'
subsystem = '$([ $SLICE = simulator ] && echo ios-simulator || echo ios)'
cpu_family = 'aarch64'
cpu = 'arm64'
endian = 'little'
EOT
}
meson_dep() { # name tarball extra-args...
  local n=$1 t=$2; shift 2; extract $n $t; meson_cross
  meson setup $BUILD/$n/_b $BUILD/$n --cross-file $BUILD/meson-cross.ini --prefix $PREFIX \
    --libdir lib --buildtype release --default-library static "$@" && ninja -C $BUILD/$n/_b install
}
autotools_dep() { # name tarball extra-args...
  local n=$1 t=$2; shift 2; extract $n $t
  (cd $BUILD/$n && ./configure --host=aarch64-apple-darwin --prefix=$PREFIX --disable-shared --enable-static \
    CC="$CC_BIN -target $TGT -isysroot $SYSROOT" CFLAGS="$CFLAGS_ALL" LDFLAGS="$LDFLAGS_ALL" "$@" \
    && make -j8 && make install)
}

step_zlib()  { cmake_dep zlib zlib-$ZLIB_V.tar.gz -DZLIB_BUILD_EXAMPLES=OFF; rm -f $PREFIX/lib/libz.dylib $PREFIX/lib/libz*.dylib; }
step_png()   { cmake_dep libpng libpng-$PNG_V.tar.xz -DPNG_SHARED=OFF -DPNG_STATIC=ON -DPNG_TESTS=OFF -DPNG_TOOLS=OFF -DPNG_FRAMEWORK=OFF -DPNG_ARM_NEON=on -DZLIB_ROOT=$PREFIX; }
step_jpeg()  { cmake_dep libjpeg-turbo libjpeg-turbo-$JPEG_V.tar.gz -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DWITH_TURBOJPEG=OFF -DWITH_JAVA=OFF -DWITH_TOOLS=OFF -DWITH_TESTS=OFF; }
step_tiff()  { cmake_dep tiff tiff-$TIFF_V.tar.gz -Dtiff-tools=OFF -Dtiff-tests=OFF -Dtiff-contrib=OFF -Dtiff-docs=OFF \
                 -Dlzma=OFF -Dzstd=OFF -Dwebp=OFF -Djbig=OFF -Dlerc=OFF -Dlibdeflate=OFF -Dcxx=OFF -Dpixarlog=OFF -DCMAKE_DISABLE_FIND_PACKAGE_OpenGL=ON; }
step_expat() { cmake_dep expat expat-$EXPAT_V.tar.xz -DEXPAT_BUILD_TOOLS=OFF -DEXPAT_BUILD_EXAMPLES=OFF -DEXPAT_BUILD_TESTS=OFF -DEXPAT_BUILD_DOCS=OFF -DEXPAT_SHARED_LIBS=OFF; }
step_lcms()  { meson_dep lcms2 lcms2-$LCMS_V.tar.gz -Djpeg=disabled -Dtiff=disabled -Dutils=false -Dsamples=false -Dfastfloat=false -Dthreaded=false; }
step_fftw()  { autotools_dep fftw fftw-$FFTW_V.tar.gz --enable-single --enable-neon --disable-fortran --disable-doc --enable-threads --with-combined-threads; }
# libffi: Apple's arm64 assembler rejects the CFI macros of sysv.S ("invalid CFI advance_loc
# expression"); CFI is not needed here, so it is turned off after configure.
step_ffi()   { extract libffi libffi-$FFI_V.tar.gz; (cd $BUILD/libffi && ./configure --host=aarch64-apple-darwin --prefix=$PREFIX \
    --disable-shared --enable-static --disable-docs --disable-multi-os-directory \
    CC="$CC_BIN -target $TGT -isysroot $SYSROOT" CFLAGS="$CFLAGS_ALL" LDFLAGS="$LDFLAGS_ALL" \
    ; find $BUILD/libffi -name fficonfig.h -exec sed -i '' 's|^#define HAVE_AS_CFI_PSEUDO_OP 1|/* #undef HAVE_AS_CFI_PSEUDO_OP */|' {} +; \
    cd $BUILD/libffi && make -j8 && make install); }
step_pcre2() { cmake_dep pcre2 pcre2-$PCRE2_V.tar.bz2 -DPCRE2_BUILD_PCRE2GREP=OFF -DPCRE2_BUILD_TESTS=OFF -DPCRE2_SUPPORT_JIT=OFF -DPCRE2_BUILD_PCRE2_8=ON; }
step_glib()  { meson_dep glib glib-$GLIB_V.tar.xz -Dtests=false -Dnls=disabled -Dlibmount=disabled -Dselinux=disabled \
                 -Dinstalled_tests=false -Dman=false -Dxattr=false -Dlibelf=disabled -Dglib_debug=disabled -Dsysprof=disabled; }
step_sigc()  { meson_dep libsigc++ libsigc++-$SIGC_V.tar.xz -Dbuild-documentation=false -Dbuild-examples=false -Dbuild-tests=false -Dbuild-pdf=false; }
step_glibmm(){ meson_dep glibmm glibmm-$GLIBMM_V.tar.xz -Dbuild-documentation=false -Dbuild-examples=false; }
step_lensfun(){ cmake_dep lensfun lensfun-$LENSFUN_V.tar.gz -DBUILD_STATIC=ON -DBUILD_TESTS=OFF -DBUILD_LENSTOOL=OFF -DBUILD_DOC=OFF -DBUILD_AUXFUN=OFF -DINSTALL_PYTHON_MODULE=OFF -DINSTALL_HELPER_SCRIPTS=OFF; }
step_exiv2() { cmake_dep exiv2 exiv2-$EXIV2_V.tar.gz -DEXIV2_ENABLE_SHARED=OFF -DEXIV2_ENABLE_XMP=ON -DEXIV2_ENABLE_EXTERNAL_XMP=OFF \
                 -DEXIV2_ENABLE_NLS=OFF -DEXIV2_ENABLE_WEBREADY=OFF -DEXIV2_ENABLE_BROTLI=OFF -DEXIV2_ENABLE_INIH=OFF \
                 -DEXIV2_ENABLE_VIDEO=OFF -DEXIV2_ENABLE_CURL=OFF -DEXIV2_BUILD_SAMPLES=OFF -DEXIV2_BUILD_EXIV2_COMMAND=OFF \
                 -DEXIV2_BUILD_UNIT_TESTS=OFF -DEXIV2_BUILD_DOC=OFF -DEXIV2_ENABLE_BMFF=ON; }
step_libraw(){ local n=libraw; rm -rf $BUILD/$n; cmake -S ${LIBRAW_SRC:-$HOME/src/LibRaw} -B $BUILD/$n "${CMAKE_COMMON[@]}" \
                 -DENABLE_OPENMP=ON "-DOpenMP_C_FLAGS=$OMPF" "-DOpenMP_CXX_FLAGS=$OMPF" -DOpenMP_C_LIB_NAMES=omp -DOpenMP_CXX_LIB_NAMES=omp -DOpenMP_omp_LIBRARY=$PREFIX/lib/libomp.a -DENABLE_LCMS=OFF -DENABLE_EXAMPLES=OFF -DENABLE_RAWSPEED=OFF -DENABLE_DCRAW_DEBUG=OFF \
                 -DENABLE_X3FTOOLS=OFF -DMATH_LIBRARY=-lm 2>&1 && ninja -C $BUILD/$n install; }

step_omp()   { local B=$BUILD/libomp; rm -rf $B
  cmake -S $SRC/llvm-openmp/runtimes -B $B "${CMAKE_COMMON[@]}" -DLLVM_ENABLE_RUNTIMES=openmp -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_DOCS=OFF \
    -DLIBOMP_ENABLE_SHARED=OFF -DLIBOMP_OMPT_SUPPORT=OFF -DLIBOMP_USE_HWLOC=OFF -DLIBOMP_FORTRAN_MODULES=OFF \
    -DOPENMP_ENABLE_LIBOMPTARGET=OFF -DLIBOMP_INSTALL_ALIASES=OFF && ninja -C $B omp \
  && mkdir -p $PREFIX/include && cp $B/openmp/runtime/src/libomp.a $PREFIX/lib/ && cp $B/openmp/runtime/src/omp.h $PREFIX/include/; }
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

ALL=(zlib png jpeg tiff expat lcms fftw ffi pcre2 glib sigc glibmm lensfun exiv2 omp libraw imath deflate openexr ctl yamlcpp pystring minizip ocio)
STEPS=("$@"); [ ${#STEPS[@]} -eq 0 ] && STEPS=("${ALL[@]}")
for s in "${STEPS[@]}"; do
  echo "== [$SLICE] $s"
  if ! ( "step_$s" ) > "$LOGS/$s.log" 2>&1; then echo "FAILED: $s (see $LOGS/$s.log)"; tail -25 "$LOGS/$s.log"; exit 1; fi
  touch "$PREFIX/.done-$s"
done
echo "all requested steps done"
