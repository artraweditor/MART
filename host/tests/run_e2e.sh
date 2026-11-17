#!/bin/sh
# Runs the end-to-end tests against a host started on a fresh copy of an image and its sidecar.
#   tests/run_e2e.sh /path/to/photo.arw [ART_BUILD_DIR]
# ART_BUILD_DIR (default ~/src/ART/build/gpu) must contain src/libart/libART.dylib (or .so) and the data files.
set -e
IMG=${1:?usage: run_e2e.sh IMAGE [ART_BUILD_DIR]}
ART=${2:-$HOME/src/ART/build/gpu}
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'kill $PID 2>/dev/null; rm -rf "$WORK"' EXIT
cp "$IMG" "$WORK/"
[ -f "$IMG.arp" ] && cp "$IMG.arp" "$WORK/"
LIB=$ART/src/libart/libART.dylib; [ -f "$LIB" ] || LIB=$ART/src/libart/libART.so
"$HERE/build/mart" --www "$HERE/../client/dist" --library "$LIB" --data "$ART/Release/ART.app/Contents/Resources" \
    --gpu off "$WORK/$(basename "$IMG")" >"$WORK/mart.log" 2>&1 &
PID=$!
for i in $(seq 1 60); do curl -s localhost:8080/api/status >/dev/null && break; sleep 0.5; done
node "$HERE/tests/ws_e2e.mjs"
node "$HERE/tests/export_e2e.mjs" http://localhost:8080
node "$HERE/tests/tools_e2e.mjs" http://localhost:8080
node "$HERE/tests/srgb_e2e.mjs" http://localhost:8080 "$WORK/$(basename "$IMG")"
# last: it saves a crop into the sidecar
node "$HERE/tests/api_e2e.mjs" http://localhost:8080 "$WORK/$(basename "$IMG")"
# the host must stop promptly with a browser connected: start a fresh one for that
kill $PID; wait $PID 2>/dev/null || true
node "$HERE/tests/shutdown_e2e.mjs" "$HERE/build/mart" --www "$HERE/../client/dist" --library "$LIB" \
    --data "$ART/Release/ART.app/Contents/Resources" --gpu off "$WORK/$(basename "$IMG")"
