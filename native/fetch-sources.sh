#!/bin/bash
# Download the sources of the dependencies (versions.sh) into native/src:
#   fetch-sources.sh [ios|android|all]       (default: all)
# Existing files are kept (a download that is not a readable archive is repeated). Also:
#   native/src/LibRaw        LibRaw at LIBRAW_REV + its CMake files (the build uses it through LIBRAW_SRC)
#   native/src/llvm-openmp   the OpenMP runtime of llvm-project (iOS only: Android has the NDK's)
#   native/src/lensfun-db    the lens database of lensfun (the data of libART: LENSFUNDB)
# ART itself is not fetched here: ART_SRC (default ~/src/ART) is a checkout of
# https://github.com/artraweditor/ART
set -euo pipefail
NATIVE=$(cd "$(dirname "$0")" && pwd)
PLATFORM=${1:-all}
. "$NATIVE/versions.sh"
SRC=${SRC:-$NATIVE/src}
mkdir -p "$SRC"

fetch() { # file url
  local f=$SRC/$1
  if [ -s "$f" ] && tar -tf "$f" >/dev/null 2>&1; then return; fi
  echo "== $1"
  curl -fL --retry 3 --retry-delay 5 -sS -o "$f.part" "$2"
  tar -tf "$f.part" >/dev/null || { echo "$1: not a readable archive" >&2; exit 1; }
  mv "$f.part" "$f"
}

fetch zlib-$ZLIB_V.tar.gz $ZLIB_URL
fetch libpng-$PNG_V.tar.xz $PNG_URL
fetch libjpeg-turbo-$JPEG_V.tar.gz $JPEG_URL
fetch tiff-$TIFF_V.tar.gz $TIFF_URL
fetch expat-$EXPAT_V.tar.xz $EXPAT_URL
fetch lcms2-$LCMS_V.tar.gz $LCMS_URL
fetch fftw-$FFTW_V.tar.gz $FFTW_URL
fetch libffi-$FFI_V.tar.gz $FFI_URL
fetch pcre2-$PCRE2_V.tar.bz2 $PCRE2_URL
fetch glib-$GLIB_V.tar.xz $GLIB_URL
fetch libsigc++-$SIGC_V.tar.xz $SIGC_URL
fetch glibmm-$GLIBMM_V.tar.xz $GLIBMM_URL
fetch lensfun-$LENSFUN_V.tar.gz $LENSFUN_URL
fetch exiv2-$EXIV2_V.tar.gz $EXIV2_URL
fetch imath-$IMATH_V.tar.gz $IMATH_URL
fetch libdeflate-$DEFLATE_V.tar.gz $DEFLATE_URL
fetch openexr-$OPENEXR_V.tar.gz $OPENEXR_URL
fetch ctl-$CTL_V.tar.gz $CTL_URL
fetch yaml-cpp-$YAMLCPP_V.tar.gz $YAMLCPP_URL
fetch pystring-$PYSTRING_V.tar.gz $PYSTRING_URL
fetch minizip-ng-$MINIZIP_V.tar.gz $MINIZIP_URL
fetch OpenColorIO-$OCIO_V.tar.gz $OCIO_URL
case $PLATFORM in android|all) fetch libiconv-$ICONV_V.tar.gz $ICONV_URL ;; esac

# the lens database that libART installs as its data
if [ ! -d "$SRC/lensfun-db" ]; then
  echo "== lensfun-db"
  mkdir -p "$SRC/lensfun-db"
  tar -xzf "$SRC/lensfun-$LENSFUN_V.tar.gz" -C "$SRC/lensfun-db" --strip-components=3 "lensfun-$LENSFUN_V/data/db"
fi

# LibRaw, at the pinned commit
if [ "$(git -C "$SRC/LibRaw" rev-parse HEAD 2>/dev/null || true)" != "$LIBRAW_REV" ]; then
  echo "== LibRaw $LIBRAW_REV"
  rm -rf "$SRC/LibRaw"; mkdir -p "$SRC/LibRaw"
  git -C "$SRC/LibRaw" init -q
  git -C "$SRC/LibRaw" fetch -q --depth 1 "$LIBRAW_URL" "$LIBRAW_REV"
  git -C "$SRC/LibRaw" checkout -q FETCH_HEAD
fi
if [ ! -f "$SRC/LibRaw/CMakeLists.txt" ]; then
  echo "== LibRaw-cmake $LIBRAW_CMAKE_REV"
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  git -C "$T" init -q
  git -C "$T" fetch -q --depth 1 "$LIBRAW_CMAKE_URL" "$LIBRAW_CMAKE_REV"
  git -C "$T" checkout -q FETCH_HEAD
  cp "$T/CMakeLists.txt" "$SRC/LibRaw/"; cp -R "$T/cmake" "$SRC/LibRaw/cmake"
fi

# the OpenMP runtime of llvm-project (the NDK has its own)
case $PLATFORM in ios|all)
  if [ ! -f "$SRC/llvm-openmp/runtimes/CMakeLists.txt" ]; then
    echo "== llvm-openmp $LLVM_V"
    rm -rf "$SRC/llvm-openmp"
    git -c advice.detachedHead=false clone -q --depth 1 --branch "llvmorg-$LLVM_V" --filter=blob:none --sparse \
        https://github.com/llvm/llvm-project.git "$SRC/llvm-openmp"
    git -C "$SRC/llvm-openmp" sparse-checkout set cmake llvm/cmake llvm/utils/llvm-lit openmp runtimes third-party/unittest
  fi ;;
esac
echo "sources in $SRC"
