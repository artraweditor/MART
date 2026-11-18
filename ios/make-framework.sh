#!/bin/bash
# Wrap libART.dylib as ART.framework: make-framework.sh <device|simulator> <out-dir>
# (the app's "Embed & Sign" step signs it; iOS frameworks are flat bundles)
set -euo pipefail
SLICE=${1:?usage: make-framework.sh device|simulator OUTDIR}; OUT=${2:?}
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=${LIBART_DYLIB:-$HERE/build/libart-$SLICE/src/libart/libART.dylib}
[ -f "$LIB" ] || { echo "missing $LIB (run build-libart.sh $SLICE)"; exit 1; }
FW=$OUT/ART.framework
rm -rf "$FW"; mkdir -p "$FW"
cp "$LIB" "$FW/ART"
install_name_tool -id @rpath/ART.framework/ART "$FW/ART"
cat > "$FW/Info.plist" <<EOT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleExecutable</key><string>ART</string>
<key>CFBundleIdentifier</key><string>org.art.ART-framework</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>ART</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>16.0</string>
</dict></plist>
EOT
echo "$FW"
