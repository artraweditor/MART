#!/bin/bash
# Run the API e2e scripts of host/tests against the app on the booted emulator/device (debug build):
#   e2e-emu.sh IMAGE      (the sidecar IMAGE.arp, if there is one, is copied too, as host/tests/run_e2e.sh does)
# Only the scripts that talk to the host through its HTTP/WebSocket API run here (ws, export, tools):
# api/dng/srgb/luts/profiles_e2e also read and write files next to the host, which needs a shared
# filesystem (the iOS simulator has one, a device does not).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); T=$HERE/../host/tests
IMG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); PORT=${PORT:-8081}; PKG=us.pixls.mart
ADB=${ADB:-adb}; command -v $ADB >/dev/null || ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
IMGS=/sdcard/Android/data/$PKG/files/Images
$ADB shell am force-stop $PKG
$ADB shell "rm -rf $IMGS/* 2>/dev/null; mkdir -p $IMGS"
$ADB shell run-as $PKG sh -c "'rm -rf cache/exports/* 2>/dev/null; true'"
$ADB push "$IMG" "$IMGS/" >/dev/null
[ -f "$IMG.arp" ] && $ADB push "$IMG.arp" "$IMGS/" >/dev/null   # the tests expect the image's sidecar
COPY=$IMGS/$(basename "$IMG")
$ADB forward tcp:$PORT tcp:$PORT >/dev/null
$ADB shell am start -n $PKG/.MainActivity --es MART_E2E_PORT $PORT >/dev/null
for i in $(seq 1 90); do curl -s -m 2 localhost:$PORT/api/status >/dev/null && break; sleep 1; done
B=http://localhost:$PORT
curl -s -X POST -H 'Content-Type: application/json' -d "{\"path\":\"$COPY\"}" $B/api/open >/dev/null || true
fail=0
t() { local n=$1; shift; echo "== $n"; ( cd "$T" && node "$n.mjs" "$@" ) || { echo "!! $n FAILED"; fail=1; }; }
t ws_e2e "$B"; t export_e2e "$B"; t tools_e2e "$B"
exit $fail
