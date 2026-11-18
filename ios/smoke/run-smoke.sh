#!/bin/bash
# Build and run the libART smoke test on a booted simulator: run-smoke.sh IMAGE [SIM_UDID]
set -euo pipefail; unset LIBRARY_PATH
HERE=$(cd "$(dirname "$0")/.." && pwd); IMG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
SIM=${2:-booted}; SDK=iphonesimulator; OUT=$HERE/build/smoke; mkdir -p "$OUT"
xcrun -sdk $SDK clang -target arm64-apple-ios16.0-simulator -isysroot "$(xcrun -sdk $SDK --show-sdk-path)" \
  -I"${ART_SRC:-$HOME/src/ART}/src/libart" "$HERE/smoke/smoke.c" -L"$HERE/build/libart-simulator/src/libart" -lART \
  -Wl,-rpath,"$HERE/build/libart-simulator/src/libart" -o "$OUT/smoke"
SIMCTL_CHILD_TMPDIR=$OUT xcrun simctl spawn "$SIM" "$OUT/smoke" "$HERE/build/art-data" "$IMG" "$OUT"
