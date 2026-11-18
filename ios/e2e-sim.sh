#!/bin/bash
# Run the e2e scripts of host/tests against the app in the simulator:
#   e2e-sim.sh IMAGE [SIM_UDID|booted]
set -euo pipefail; unset LIBRARY_PATH
HERE=$(cd "$(dirname "$0")" && pwd); T=$HERE/../host/tests
IMG=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); SIM=${2:-booted}; ID=org.mart.MART; PORT=${PORT:-8080}
xcrun simctl terminate "$SIM" $ID 2>/dev/null || true
DATA=$(xcrun simctl get_app_container "$SIM" $ID data)
mkdir -p "$DATA/Documents/Images" "$DATA/Library/Application Support/MART/profiles" "$DATA/Library/Application Support/MART/luts"
COPY=$DATA/Documents/Images/$(basename "$IMG"); rm -rf "$DATA/Documents/Exports"/* "$DATA/Documents/Images"/*; cp "$IMG" "$COPY"
PROF="$DATA/Library/Application Support/MART/profiles"; LUTS="$DATA/Library/Application Support/MART/luts"
cp "$HERE/build/art-data/luts/sigmoid.ctl" "$LUTS/" 2>/dev/null || true
printf '%s\n' '[Sharpening]' Enabled=true Method=rld DeconvAutoRadius=false DeconvRadius=1 DeconvAmount=77 Contrast=20 > "$PROF/Sharpening.arp"
SIMCTL_CHILD_MART_E2E_PORT=$PORT xcrun simctl launch "$SIM" $ID >/dev/null
for i in $(seq 1 60); do curl -s localhost:$PORT/api/status >/dev/null && break; sleep 0.5; done
B=http://localhost:$PORT
curl -s -X POST -H 'Content-Type: application/json' -d "{\"path\":\"$COPY\"}" $B/api/open >/dev/null || true
t() { local n=$1; shift; echo "== $n"; ( cd "$T" && node "$n.mjs" "$@" ) || echo "!! $n FAILED"; }
t ws_e2e "$B"; t export_e2e "$B"; t tools_e2e "$B"; t profiles_e2e "$B" "$COPY" "$PROF"
t luts_e2e "$B" "$LUTS" "$PROF"; t dng_e2e "$B" "$COPY"; t srgb_e2e "$B" "$COPY"; t api_e2e "$B" "$COPY"
