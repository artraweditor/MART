#!/bin/bash
# Build libART (in-process engine + its dependencies, statically linked) for a platform.
# Usage: build-libart.sh <ios|android> <slice> [target ...]   (default target: art-lib)
set -euo pipefail
unset LIBRARY_PATH CPATH
PLATFORM=${1:?usage: build-libart.sh ios|android slice [target...]}; SLICE=${2:?slice}; shift 2 || true
NATIVE=$(cd "$(dirname "$0")" && pwd)
. "$NATIVE/platform/$PLATFORM.sh"
PREFIX=$DEPS/prefix/$SLICE; BUILD=$DEPS/build/$SLICE
platform_setup
ART_SRC=${ART_SRC:-$HOME/src/ART}
B=${LIBART_BUILD_DIR:-$ROOT/build/libart-$SLICE}
export PATH=/opt/homebrew/bin:$PATH
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig PKG_CONFIG_PATH=
P=$PREFIX/lib
platform_libart_setup
cmake -S "$ART_SRC" -B "$B" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN ${PLATFORM_CMAKE_ARGS[@]+"${PLATFORM_CMAKE_ARGS[@]}"} \
  -DCMAKE_BUILD_TYPE=Release \
  -DART_BUILD_GUI=OFF -DART_BUILD_CLI=OFF -DART_BUILD_LIBART=ON -DART_LIBART_EMBED=ON \
  -DOPTION_OMP=ON -DENABLE_OCIO=ON -DENABLE_CTL=ON -DENABLE_VULKAN=OFF -DENABLE_MIMALLOC=OFF \
  "-DOpenMP_C_FLAGS=$OMPF" "-DOpenMP_CXX_FLAGS=$OMPF" -DOpenMP_C_LIB_NAMES=omp -DOpenMP_CXX_LIB_NAMES=omp \
  -DOpenMP_omp_LIBRARY=$P/libomp.a -DCTL_LIBRARY_DIR=$P \
  "-DCMAKE_CXX_STANDARD_LIBRARIES=$STATICDEPS" \
  -DENABLE_LIBRAW=ON -DBUILD_SHARED=OFF \
  -DCMAKE_INSTALL_PREFIX=$ROOT/build/art-install-$SLICE -DDATADIR=$ROOT/build/art-data \
  -DLENSFUNDB_SOURCE_DIR=${LENSFUNDB:-$HOME/.local/share/lensfun/updates/version_1} \
  "-DCMAKE_SHARED_LINKER_FLAGS=$LIBART_LDFLAGS" \
  ${ART_CMAKE_EXTRA:-}
if [ $# -eq 0 ]; then set -- art-lib; fi
ninja -C "$B" "$@"
