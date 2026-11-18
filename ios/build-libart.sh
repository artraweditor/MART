#!/bin/bash
# Build libART (in-process engine + its dependencies, statically linked) for iOS.
# Usage: build-libart.sh <device|simulator> [target ...]   (default target: art-lib)
set -euo pipefail
unset LIBRARY_PATH CPATH
SLICE=${1:?usage: build-libart.sh device|simulator [target...]}; shift || true
HERE=$(cd "$(dirname "$0")" && pwd)
ART_SRC=${ART_SRC:-$HOME/src/ART}
B=${LIBART_BUILD_DIR:-$HERE/build/libart-$SLICE}
export PATH=/opt/homebrew/bin:$PATH
export IOS_SLICE=$SLICE
export PKG_CONFIG_LIBDIR=$HERE/deps/prefix/$SLICE/lib/pkgconfig PKG_CONFIG_PATH=
# glib's constructors (glib_init, gobject init) must run before the C++ static initializers
# of the engine, which use GLib (the order follows the link order of the objects in the dylib).
P=$HERE/deps/prefix/$SLICE/lib
# Apple clang has no -fopenmp of its own: preprocessor flag + the static libomp of deps/
OMPF="-Xpreprocessor -fopenmp -I$P/../include"
# the static dependencies that the .pc files of OpenColorIO, OpenEXR and CTL do not list
STATICDEPS="-lOpenEXR-3_2 -lOpenEXRCore-3_2 -lIlmThread-3_2 -lIex-3_2 -lImath-3_2 -ldeflate -lyaml-cpp -lpystring -lminizip -lcompression -lz -lexpat"
cmake -S "$ART_SRC" -B "$B" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=$HERE/deps/toolchain-ios.cmake -DIOS_SLICE=$SLICE \
  -DCMAKE_BUILD_TYPE=Release \
  -DART_BUILD_GUI=OFF -DART_BUILD_CLI=OFF -DART_BUILD_LIBART=ON -DART_LIBART_EMBED=ON \
  -DOPTION_OMP=ON -DENABLE_OCIO=ON -DENABLE_CTL=ON -DENABLE_VULKAN=OFF -DENABLE_MIMALLOC=OFF \
  "-DOpenMP_C_FLAGS=$OMPF" "-DOpenMP_CXX_FLAGS=$OMPF" -DOpenMP_C_LIB_NAMES=omp -DOpenMP_CXX_LIB_NAMES=omp \
  -DOpenMP_omp_LIBRARY=$P/libomp.a -DCTL_LIBRARY_DIR=$P \
  "-DCMAKE_CXX_STANDARD_LIBRARIES=$STATICDEPS" \
  -DENABLE_LIBRAW=ON -DBUILD_SHARED=OFF \
  -DCMAKE_INSTALL_PREFIX=$HERE/build/art-install-$SLICE -DDATADIR=$HERE/build/art-data \
  -DLENSFUNDB_SOURCE_DIR=${LENSFUNDB:-$HOME/.local/share/lensfun/updates/version_1} \
  "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-force_load,$P/libglib-2.0.a -Wl,-force_load,$P/libgobject-2.0.a" \
  ${ART_CMAKE_EXTRA:-}
if [ $# -eq 0 ]; then set -- art-lib; fi
ninja -C "$B" "$@"
