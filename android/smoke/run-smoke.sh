#!/bin/bash
# Build and run the libART smoke test (ios/smoke/smoke.c, shared) on a booted Android emulator/device:
#   run-smoke.sh IMAGE      (output: android/build/smoke/*)
# Pushes libART.so (stripped copy), the art-data folder and the image to /data/local/tmp/mart-smoke.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd); REPO=$(dirname "$HERE")
IMG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
case "$(uname -s)" in Darwin) NDK_HOST=darwin-x86_64 ;; *) NDK_HOST=linux-x86_64 ;; esac
NDK=${ANDROID_NDK_HOME:-/opt/homebrew/share/android-ndk}; NB=$NDK/toolchains/llvm/prebuilt/$NDK_HOST/bin
ADB=${ADB:-adb}; command -v $ADB >/dev/null || ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
OUT=$HERE/build/smoke; mkdir -p "$OUT"
LIBDIR=$HERE/build/libart-arm64/src/libart
DATA=${ART_DATA:-$REPO/ios/build/art-data}      # the libart_data component, the same for all platforms
$NB/aarch64-linux-android26-clang -I"${ART_SRC:-$HOME/src/ART}/src/libart" "$REPO/ios/smoke/smoke.c" \
  -L"$LIBDIR" -lART -Wl,-z,max-page-size=16384 -o "$OUT/smoke"
$NB/llvm-strip --strip-unneeded -o "$OUT/libART.so" "$LIBDIR/libART.so"
R=/data/local/tmp/mart-smoke
$ADB shell "rm -rf $R; mkdir -p $R/out"
$ADB push "$OUT/smoke" "$OUT/libART.so" $R/ >/dev/null
[ -n "$($ADB shell "ls $R/art-data 2>/dev/null | head -1")" ] || $ADB push "$DATA" $R/art-data >/dev/null
$ADB push "$IMG" $R/image >/dev/null
$ADB shell "cd $R && chmod +x smoke && LD_LIBRARY_PATH=$R TMPDIR=$R/out ./smoke $R/art-data $R/image $R/out"
rm -rf "$OUT/out"; $ADB pull $R/out "$OUT/out" >/dev/null && ls -l "$OUT/out"
