#!/bin/bash
# The version of MART, from one place: $MART_VERSION (CI sets it: the tag, or "nightly-<hash>"), else
# the default of MART_VERSION in host/CMakeLists.txt. The apps must carry the same version as the host.
#   version.sh           the version as is: "0.1.0", "v1.2.3", "nightly-abc1234"
#   version.sh numeric   what the stores accept (digits and dots: "1.2.3"); a version that does not
#                        start with one ("nightly-...") gives the default of the CMakeLists
#   version.sh code      an integer that grows with the numeric version (1.2.3 -> 10203; the build
#                        number of an app: CFBundleVersion, versionCode)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
DEFAULT=$(sed -n 's/^set(MART_VERSION "\([^"]*\)".*/\1/p' "$REPO/host/CMakeLists.txt")
[ -n "$DEFAULT" ] || { echo "no MART_VERSION in host/CMakeLists.txt" >&2; exit 1; }
V=${MART_VERSION:-$DEFAULT}
numeric() {
    local n; n=$(sed -nE 's/^v?([0-9]+(\.[0-9]+){0,2}).*/\1/p' <<< "$1")
    if [ -n "$n" ]; then echo "$n"; else sed -nE 's/^v?([0-9]+(\.[0-9]+){0,2}).*/\1/p' <<< "$DEFAULT"; fi
}
case "${1:-}" in
"") echo "$V" ;;
numeric) numeric "$V" ;;
code) IFS=. read -r a b c <<< "$(numeric "$V")"; echo $(( ${a:-0} * 10000 + ${b:-0} * 100 + ${c:-0} )) ;;
*) echo "usage: version.sh [numeric|code]" >&2; exit 1 ;;
esac
