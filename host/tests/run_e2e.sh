#!/bin/sh
#
#  This file is part of MART.
#
#  Copyright 2026 Alberto Griggio <alberto.griggio@gmail.com>
#
#  MART is free software: you can redistribute it and/or modify
#  it under the terms of the GNU General Public License as published by
#  the Free Software Foundation, either version 3 of the License, or
#  (at your option) any later version.
#
#  MART is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License
#  along with MART.  If not, see <http://www.gnu.org/licenses/>.

# Runs the end-to-end tests against a host started on a fresh copy of an image
# and its sidecar.
#   tests/run_e2e.sh /path/to/photo.arw [ART_BUILD_DIR]
# ART_BUILD_DIR (default ~/src/ART/build/gpu) must contain
# src/libart/libART.dylib (or .so) and the data files.
set -e
IMG=${1:?usage: run_e2e.sh IMAGE [ART_BUILD_DIR]}
ART=${2:-$HOME/src/ART/build/gpu}
HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'kill $PID 2>/dev/null; rm -rf "$WORK"' EXIT
cp "$IMG" "$WORK/"
[ -f "$IMG.arp" ] && cp "$IMG.arp" "$WORK/"
# MART's profile folder for the tests: never the user's own
mkdir "$WORK/profiles" "$WORK/luts"
DATA="$ART/Release/ART.app/Contents/Resources"
cp "$DATA/luts/sigmoid.ctl" "$WORK/luts/"
printf '%s\n' '[Sharpening]' Enabled=true Method=rld DeconvAutoRadius=false \
    DeconvRadius=1 DeconvAmount=77 Contrast=20 > "$WORK/profiles/Sharpening.arp"
LIB=$ART/src/libart/libART.dylib; [ -f "$LIB" ] || LIB=$ART/src/libart/libART.so
COPY="$COPY"
"$HERE/build/mart" --www "$HERE/../client/dist" --library "$LIB" \
    --data "$DATA" --gpu off --profiles "$WORK/profiles" --luts "$WORK/luts" \
    "$COPY" >"$WORK/mart.log" 2>&1 &
PID=$!
for i in $(seq 1 60); do
    curl -s localhost:8080/api/status >/dev/null && break
    sleep 0.5
done
node "$HERE/tests/ws_e2e.mjs"
node "$HERE/tests/export_e2e.mjs" http://localhost:8080
node "$HERE/tests/tools_e2e.mjs" http://localhost:8080
node "$HERE/tests/thumbnail_e2e.mjs" http://localhost:8080
node "$HERE/tests/images_e2e.mjs" http://localhost:8080
node "$HERE/tests/profiles_e2e.mjs" http://localhost:8080 "$COPY" \
    "$WORK/profiles"
node "$HERE/tests/luts_e2e.mjs" http://localhost:8080 "$WORK/luts" \
    "$WORK/profiles"
node "$HERE/tests/dng_e2e.mjs" http://localhost:8080 "$COPY"
node "$HERE/tests/srgb_e2e.mjs" http://localhost:8080 "$COPY"
# last: it saves a crop into the sidecar
node "$HERE/tests/api_e2e.mjs" http://localhost:8080 "$COPY"
# the host must stop promptly with a browser connected: start a fresh one for
# that
kill $PID; wait $PID 2>/dev/null || true
node "$HERE/tests/shutdown_e2e.mjs" "$HERE/build/mart" \
    --www "$HERE/../client/dist" --library "$LIB" --data "$DATA" --gpu off \
    --profiles "$WORK/profiles" --luts "$WORK/luts" "$COPY"
