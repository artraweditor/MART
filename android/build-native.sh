#!/bin/bash
# Build the native parts of the app and put them where Gradle packages them:
#   build-native.sh [debug|release]
#   app/src/main/jniLibs/arm64-v8a/libmart.so  (JNI shim + MART host)
#   app/src/main/jniLibs/arm64-v8a/libART.so   (stripped copy of the engine, from native/build-libart.sh)
#   app/src/main/assets/{www,art-data}         (client build and the libart_data component)
set -euo pipefail; unset LIBRARY_PATH CPATH
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(dirname "$HERE")
export PATH=/opt/homebrew/bin:$PATH ANDROID_NDK_HOME=${ANDROID_NDK_HOME:-/opt/homebrew/share/android-ndk} ANDROID_SLICE=arm64
case "$(uname -s)" in Darwin) NDK_HOST=darwin-x86_64 ;; *) NDK_HOST=linux-x86_64 ;; esac
NB=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$NDK_HOST/bin
JL=$HERE/app/src/main/jniLibs/arm64-v8a; AS=$HERE/app/src/main/assets
B=$HERE/build/jni-arm64
mkdir -p "$JL" "$AS"
[ -f "$HERE/build/libart-arm64/src/libart/libART.so" ] || INSTALL_DATA=1 "$REPO/native/build-libart.sh" android arm64
cmake -S "$HERE/jni" -B "$B" -G Ninja -DCMAKE_TOOLCHAIN_FILE=$HERE/deps/toolchain-android.cmake -DCMAKE_BUILD_TYPE=Release \
  ${MART_VERSION:+-DMART_VERSION="$MART_VERSION"}
ninja -C "$B"
$NB/llvm-strip --strip-unneeded -o "$JL/libmart.so" "$B/libmart.so"
$NB/llvm-strip --strip-unneeded -o "$JL/libART.so" "$HERE/build/libart-arm64/src/libart/libART.so"
( cd "$REPO/client" && npm run build > "$HERE/build/client.log" 2>&1 ) || { tail -20 "$HERE/build/client.log"; exit 1; }
rsync -a --delete "$REPO/client/dist/" "$AS/www/"
# libart_data (INSTALL_DATA=1 native/build-libart.sh ...) is the same for all platforms: ours, or the iOS build's
DATA=${ART_DATA:-$HERE/build/art-data}
[ -d "$DATA" ] || DATA=$REPO/ios/build/art-data
[ -d "$DATA" ] || { echo "missing the data of libART: INSTALL_DATA=1 native/build-libart.sh android arm64"; exit 1; }
rsync -a --delete "$DATA/" "$AS/art-data/"
ls -l "$JL"
