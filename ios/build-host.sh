#!/bin/bash
# Build libmart-host.a (the MART host, without main()) for iOS: build-host.sh <device|simulator>
set -euo pipefail; unset LIBRARY_PATH CPATH
SLICE=${1:?usage: build-host.sh device|simulator}
HERE=$(cd "$(dirname "$0")" && pwd)
export PATH=/opt/homebrew/bin:$PATH IOS_SLICE=$SLICE
B=$HERE/build/host-$SLICE
cmake -S "$HERE/../host" -B "$B" -G Ninja -DCMAKE_TOOLCHAIN_FILE=$HERE/deps/toolchain-ios.cmake -DIOS_SLICE=$SLICE \
  -DCMAKE_BUILD_TYPE=Release -DMART_IOS=ON ${MART_VERSION:+-DMART_VERSION="$MART_VERSION"}
ninja -C "$B"
ls -la "$B/libmart-host.a"
