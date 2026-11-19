#!/bin/bash
# Build the static dependencies of libART for iOS: build-deps.sh <device|simulator> [step ...]
# (a wrapper of the shared native/build-deps.sh)
exec "$(cd "$(dirname "$0")/../../native" && pwd)/build-deps.sh" ios "$@"
