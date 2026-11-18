#!/bin/bash
# Build the MART app: build-app.sh <simulator|device> [xcodebuild args...]; the app is left in
# MART/build/dd/Build/Products/Debug-<iphonesimulator|iphoneos>/MART.app
set -euo pipefail; unset LIBRARY_PATH CPATH
SLICE=${1:?usage: build-app.sh simulator|device}; shift
cd "$(dirname "$0")/MART"
export PATH=/opt/homebrew/bin:$PATH
xcodegen generate -q
if [ "$SLICE" = simulator ]; then SDK=iphonesimulator; DEST='generic/platform=iOS Simulator'; EXTRA=(CODE_SIGN_IDENTITY=-)
else SDK=iphoneos; DEST='generic/platform=iOS'; EXTRA=(); fi
xcodebuild -project MART.xcodeproj -scheme MART -sdk $SDK -destination "$DEST" -derivedDataPath build/dd ${EXTRA[@]+"${EXTRA[@]}"} "$@" build 2>&1 | grep -E "error:|\*\* BUILD"
