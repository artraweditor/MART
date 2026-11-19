#!/bin/bash
# Build libART for iOS: build-libart.sh <device|simulator> [target ...]   (default target: art-lib)
# (a wrapper of the shared native/build-libart.sh)
exec "$(cd "$(dirname "$0")/../native" && pwd)/build-libart.sh" ios "$@"
