#!/bin/bash
# Build phases of the app (run by Xcode): phases.sh prebuild | bundle
set -euo pipefail
unset LIBRARY_PATH CPATH
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
IOS=$(cd "$SRCROOT/.." && pwd)
SLICE=$([ "${PLATFORM_NAME:-}" = iphonesimulator ] && echo simulator || echo device)
case "$1" in
prebuild)
  # the host library for this slice; the client (www) and libART are built beforehand
  # by ios/build-all.sh (long builds stay out of Xcode); here only what is cheap
  "$IOS/build-host.sh" "$SLICE" > "$IOS/build/host-$SLICE.log" 2>&1 || { tail -30 "$IOS/build/host-$SLICE.log"; exit 1; }
  ( cd "$IOS/../client" && [ -d node_modules ] && npm run build > "$IOS/build/client.log" 2>&1 ) || { tail -20 "$IOS/build/client.log"; exit 1; }
  ;;
bundle)
  APP="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
  rm -rf "$APP/www" "$APP/art-data" "$APP/Frameworks/ART.framework"
  mkdir -p "$APP/Frameworks"
  rsync -a --delete "$IOS/../client/dist/" "$APP/www/"
  rsync -a --delete "$IOS/build/art-data/" "$APP/art-data/"
  "$IOS/make-framework.sh" "$SLICE" "$APP/Frameworks" > /dev/null
  # sign the embedded framework with the identity of the app ("-": ad hoc, for the simulator)
  # (an unsigned build, CODE_SIGNING_ALLOWED=NO, leaves it: ios/build-ipa.sh)
  if [ "${CODE_SIGNING_ALLOWED:-YES}" != NO ]; then
    ID=${EXPANDED_CODE_SIGN_IDENTITY:--}; [ -n "$ID" ] || ID=-
    codesign --force --sign "$ID" --timestamp=none "$APP/Frameworks/ART.framework"
  fi
  ;;
esac
