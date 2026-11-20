#!/bin/bash
# Build an unsigned .ipa of the app for the device, to be signed by whoever installs it (AltStore,
# Sideloadly, Xcode's "Devices", ...):  build-ipa.sh [OUT.ipa]    (default: build/MART-unsigned.ipa)
# Needs the device slice: deps/build-deps.sh device, ./build-libart.sh device (INSTALL_DATA=1 for the data).
#
# What AltStore (classic) needs of an .ipa, and what this makes: a zip with Payload/MART.app, an
# Info.plist with a bundle id and version, every nested framework a proper bundle (Frameworks/ART.framework has
# its Info.plist: AltServer signs each one), no entitlements in the app (it signs with the Apple ID's
# own, and gives the app its own bundle id: nothing here depends on ours), and no signatures (a
# clean binary; they are all replaced). It needs iOS 16 or later.
set -euo pipefail; unset LIBRARY_PATH CPATH
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HERE/build/MART-unsigned.ipa}
case $OUT in /*) ;; *) OUT=$PWD/$OUT ;; esac
mkdir -p "$(dirname "$OUT")"

# no signing, and none of the personal team of project.yml
"$HERE/build-app.sh" device -configuration Release \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM=
APP=$HERE/MART/build/dd/Build/Products/Release-iphoneos/MART.app
[ -d "$APP" ] || { echo "missing $APP"; exit 1; }

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir "$W/Payload"
cp -R "$APP" "$W/Payload/MART.app"
find "$W/Payload" -name _CodeSignature -prune -exec rm -rf {} +
rm -f "$W/Payload/MART.app/embedded.mobileprovision"
# the linker signs what it makes (ad hoc): remove it, so that nothing is left to confuse a signer
while IFS= read -r f; do
    if file "$f" | grep -q "Mach-O"; then codesign --remove-signature "$f" 2>/dev/null || true; fi
done < <(find "$W/Payload" -type f)

rm -f "$OUT"
( cd "$W" && zip -qry "$OUT" Payload )

# what was made
echo "== $OUT ($(du -h "$OUT" | cut -f1))"
PL=$W/Payload/MART.app/Info.plist
for k in CFBundleIdentifier CFBundleShortVersionString CFBundleVersion MinimumOSVersion; do
    printf '%-28s %s\n' $k "$(/usr/libexec/PlistBuddy -c "Print :$k" "$PL" 2>/dev/null || echo '-')"
done
printf '%-28s %s\n' "frameworks" "$(ls "$W/Payload/MART.app/Frameworks" 2>/dev/null | tr '\n' ' ')"
printf '%-28s %s\n' "architectures" "$(lipo -archs "$W/Payload/MART.app/MART")"
sig=$(codesign -dv "$W/Payload/MART.app" 2>&1 || true)   # (it fails on an unsigned bundle: not under pipefail)
if grep -q "not signed at all" <<< "$sig"; then echo "signature: none"
else echo "signature: STILL SIGNED"; echo "$sig"; exit 1; fi
