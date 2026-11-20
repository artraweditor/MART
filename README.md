# MART (Mobile ART)

A touch-first, single-image raw editor for tablets and phones. It drives the ART engine
through libART and saves standard ART sidecars (`.arp`), so a shoot can be finished in desktop ART.

    host/     C++ host: serves the web client, talks to libART (HTTP + WebSocket)
    client/   TypeScript web client (ES modules, no runtime dependencies)

## Build and run

    cd host && cmake -S . -B build -G Ninja && cmake --build build
    cd ../client && npm install && npm run build

    ART=~/src/ART/build/gpu          # a build of ART that has libART and `apply --merge`
    host/build/mart --www client/dist \
        --library $ART/src/libart/libART.dylib \
        --data $ART/Release/ART.app/Contents/Resources  /path/to/photo.arw

Then open http://localhost:8080. `--listen 0.0.0.0` makes it reachable from a tablet on the
network; the server then requires the token it prints (open the printed URL).
`--require-token` asks for the token on the loopback address too (other programs of
the machine can reach it), and `--port 0` picks a free port. Temporary files go to
`$TMPDIR` (or `/tmp`). The host is also a library (`app.h`: `mart::run`, `mart::stop`,
and a C interface) that an app can embed; `main.cc` only adds the signals.
`--socket PATH` uses a running `ART-cli --server` instead of the in-process engine.

## What it does

Tone, Color, Detail, Retouch and Crop tabs (exposure and highlight recovery, a haze removal slider (ART's dehaze with a straight
strength curve, in RGB mode), contrast, base curve, a point-curve editor, tone
equalizer; white balance with a neutral-gray picker, saturation, channel mixer (primaries mode), soft light; lens
correction from the automatic or embedded data, and the flat field embedded in the raw file (DNG gain maps, on by
default for a DNG that has no saved choice), capture sharpening by Richardson-Lucy deconvolution, film grain and
halation; film simulation with a LUT picked from MART's own (including CTL scripts with their
parameters); retouching regions with a brush mask (see below); crop with ratios,
quarter turns, flips and straightening), an Other tab that lists, read-only, the tools of the profile that have no
controls here (they are kept on Save profile), undo/redo, and header icons for **Manage profiles**, **Export**
(JPEG, PNG or TIFF at full size or resized to 1920, 2560 or 3840 px, then a download), **Image information** (and
metadata), **Open another image** and **Save profile** (the standard `.arp` sidecar). Opening another image never
drops unsaved edits silently. In a browser the Open sheet browses the folders that the host allows (`--root`, by
default the folder of the image it was started with) with their subfolders and the thumbnails of the images, or opens a
file or a folder whose path is typed; the apps list the folders of the device.

## Profiles

MART has its own profiles (partial `.arp` files), kept in one folder, `~/.config/MART/profiles` (or
`$XDG_CONFIG_HOME/MART/profiles`; `--profiles DIR` changes it). ART's own profiles are not offered. The **Manage profiles** sheet:

- applies a profile (undo takes all of it away), or the built-in *Neutral* (every tool at its default), or a profile
  "add to my local adjustments" keeps the image's local tools instead of replacing them;
- **imports** a profile from a file of the device (a file dialog), under a name that can be set;
- **saves the current settings** as a profile, with a checkbox for each section of the interface (exposure, haze
  removal, tone curve, tone equalizer, white balance, saturation, channel mixer, soft light, film simulation, lens
  correction with the flat field, capture sharpening, film grain, halation, crop and rotation). A section stands for
  the parameters that it edits, which do not always follow ART's groups (the flat field is a few keys of the raw
  group; the halation is a region of the smoothing tool, which is added to the image's own regions when the profile
  is applied). White balance and crop are not checked at first, since they belong to the picture;
- **renames** and **deletes** the profiles of the folder (the **⋯** of a row; a delete is asked again);
- marks one profile with a **star**: it is applied when a picture is opened that has no sidecar (not for one that
  has). Such a picture starts from the neutral profile, not from what ART would load for it (its default or dynamic
  profile), and then gets the starred profile. This is where the history starts: it cannot be undone and is not an
  unsaved edit. There are no rules and no difference between raw and other files.

On a phone (or any narrow screen) the tool panel floats over the picture at about 80% opacity; tap the picture, or the open tab, to fold it away.

Export renders the whole image with the current edits, saved or not. A resized export uses ART's fast export pipeline
(`export --fast SIZE`: the longest edge is at most SIZE). It keeps the engine busy for seconds to
minutes, so editing waits and the interface says so. Files go to a temporary folder and are downloaded by the
browser; `--export-dir DIR` also keeps them in DIR.

## Installing it as an app

MART is a PWA (manifest, icons, service worker). Browsers only install web apps and run service workers from a
**secure context**: `http://localhost`, or HTTPS. So on the machine running MART it can be installed as it is; from a
tablet on the network (`http://192.168.x.x:8080`) it works as a web page but cannot be installed or cached, unless
it is served over HTTPS (for example through a reverse proxy or a tunnel that provides a certificate). Once
installed, the app opens without the server and shows "Cannot reach the MART server" until it is back.
The PNG icons are made from `client/icons/MART-portrait.svg` by `client/make-icons.sh` (needs `rsvg-convert`).

## Tests

    cd host && ctest --test-dir build                  # patch serialiser, key allowlist, export requests
    cd client && npm test                              # patch helpers, crop geometry, export options (after npm run build)
    host/tests/run_e2e.sh /path/to/photo.arw           # live channel, export, profiles, geometry, Save, clean shutdown
    # browser tests (headless Chrome), with a host running on a COPY of an image (Save writes its sidecar):
    node host/tests/ui_smoke.mjs http://localhost:8080 /tmp           # sliders, undo
    node host/tests/ui_m3.mjs http://localhost:8080 /tmp /path/copy.arw   # crop drags, sheets, white balance, Save
    node host/tests/ui_m4.mjs http://localhost:8080 /tmp              # export sheet, busy state, download
    node host/tests/tools_e2e.mjs http://localhost:8080               # every tool's patch against the engine (changes the open image, not the sidecar)
    node host/tests/ui_tools.mjs http://localhost:8080 /tmp           # curve editor and the new tools (use a freshly started host)
    node host/tests/ui_extras.mjs http://localhost:8080 /tmp          # grain, halation, film simulation, Other tab (fresh host)
    node host/tests/ui_retouch.mjs http://localhost:8080 /tmp         # the Retouch tab: regions, sliders, painting (fresh host)
    node host/tests/ui_overflow.mjs http://localhost:8080 /tmp        # no sideways scrolling on phone widths
    node host/tests/ui_srgb.mjs http://localhost:8080 /tmp            # the preview stays sRGB whatever the profiles say (fresh host)
    node host/tests/srgb_e2e.mjs http://localhost:8080 /path/copy.arw   # exports are sRGB (a COPY: it rewrites its sidecar)
    node host/tests/profiles_e2e.mjs http://localhost:8080 /path/copy.arw DIR   # saving, applying, the default (host with --profiles DIR)
    node host/tests/ui_profiles.mjs http://localhost:8080 /tmp        # the Manage profiles sheet and the Save dialog (fresh host, own --profiles DIR)
    node host/tests/luts_e2e.mjs http://localhost:8080 LUTS_DIR PROFILES_DIR   # the LUT folder, and the R host in profiles (host with --luts and --profiles)
    node host/tests/ui_luts.mjs http://localhost:8080 /tmp            # the LUT drop-down and Manage LUTs (fresh host, own --luts DIR with sigmoid.ctl)
    node host/tests/ui_panel.mjs http://localhost:8080 /tmp           # the floating panel on a phone
    node host/tests/ui_resize.mjs http://localhost:8080 /tmp          # the picture stays fitted when the view changes
    MART_CMD='host/build/mart ... photo.arw' node host/tests/ui_reconnect.mjs    # server away and back
    MART_CMD='host/build/mart ... photo.arw' node host/tests/ui_pwa.mjs          # manifest, service worker, offline start

Retouching regions are regions of ART's Color/tone correction tool (`[ColorCorrection]`) in perceptual mode, named
`MART retouch <id>` and added after the regions that the sidecar already has; in desktop ART they are ordinary regions.
Each has a hue shift, an output saturation, gain (highlights), lift (shadows), gamma (midtones), pivot and compression
(gain, gamma and pivot are in stops: 0 is no change); a brush mask can limit it (feather, opacity and smoothness as in
ART, a brush size, a hardness and an eraser; the mask contrast curve and the brush mode are left out: the brush is the
only mask, in "intersect" mode, so a region with a brush mask and nothing painted does nothing). Paint with the mouse
or one finger; two fingers pan and zoom. Painting is a mode of its own ("Edit the mask"): the strokes show as a red overlay, with Undo stroke, Clear and Discard, until Commit sends them to the engine (leaving the tab commits too). A profile saved with the "Retouching"
section replaces the retouching regions of the image and keeps its other ones.

Halation is a region of ART's Smoothing tool in halation mode, without a mask, named `MART halation` and added after
the regions that the sidecar already has; in desktop ART it appears as an ordinary smoothing region.

## Needs ART's `apply --merge`, `get-clut-params`, an sRGB `preview` and `export --profile`

One history entry per slider drag needs the `apply --merge KEY` option of ART's server mode
(see `doc/server_mode.md` in ART). Without it every step of a drag is an undo step.
The `preview` command must always render in sRGB (as it does in current ART: whatever the output, working or monitor
profile); the host tags the frames as sRGB, so that colours are right on wide-gamut screens. With an older ART the
preview is in the monitor or working profile and the colours are wrong. Exports are always sRGB too, whatever the
output profile of the image says: the host gives every export a small profile with `export --profile`, which overrides
the output profile for that export only (the image, its history and its sidecar are not touched).
The parameters of a CTL script, with their labels translated, are read with ART's `get-clut-params FILE` command (see
the same document); without it a LUT can still be chosen but its parameters are not shown. 

## LUTs

The film simulation uses MART's own LUTs, kept in one folder, `~/.config/MART/luts` (or `$XDG_CONFIG_HOME/MART/luts`;
`--luts DIR` changes it), not ART's. The LUT is picked from a drop-down of those installed, and **Manage LUTs** imports a
LUT from a file of the device (a Hald CLUT image, a CLF file or a CTL script; the name can be set, the extension is the
file's), renames and deletes them.

A profile that is saved holds a LUT of the folder as ART writes the LUTs of its own folder: `file://R/<path in the
folder>`, where the host name `R` means relative. So the profile can be applied in ART if the same LUT is installed in its
LUT folder; and when MART applies a profile, a LUT with an `R` URI (or a relative path) is looked for in MART's folder.
A LUT elsewhere keeps the path that ART gives it. Renaming or deleting a LUT breaks the profiles and sidecars that name it.

## Apps for Android and iOS

The apps (`android/`, `ios/`) are a web view that shows the client, with the host and libART inside; see
`android-plan.md` and `ios-plan.md` for how they work and `native/` for the build of the dependencies of libART.

GitHub builds them (`.github/workflows/`), by hand (Actions > Android APK / iOS IPA > Run workflow) or when a
tag `v*` is pushed (the files are then attached to its release):

- **Android APK** (`android.yml`, `MART-android-arm64.apk`): with the secrets `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (and `ANDROID_KEY_PASSWORD` if the key has its own) it is signed
  with your key; without them with a throwaway key made for the run (it installs, but cannot update an app installed
  from another run).
- **iOS IPA** (`ios.yml`, `MART-ios-unsigned.ipa`): **unsigned**, so that whoever installs it signs it with their
  own Apple ID: AltStore (classic: "My Apps" > "+", or open the file with AltStore on the device), Sideloadly, or Xcode.
  It runs on iPhones and iPads (iOS 16 or later) and has no entitlements and no extensions, which is what AltStore wants; a free
  Apple ID keeps it 7 days (AltStore refreshes it) and allows 3 apps at a time.

Both build libART from [artraweditor/ART](https://github.com/artraweditor/ART) (the input `art_ref` of the
workflows says which branch, tag or commit; it needs the `thumbnail` command) and its dependencies with
`native/build-deps.sh`: the first run takes an hour or more, and the dependencies are then cached until `native/`
or the toolchain changes. The Android build runs on Linux (`ubuntu-24.04`, the repository variable `MART_ANDROID_RUNNER` picks another image),
the iOS one on `macos-26` (`MART_IOS_RUNNER`). Locally: `native/fetch-sources.sh`, `native/build-deps.sh`,
`native/build-libart.sh` (`INSTALL_DATA=1` for the data), then `android/build-native.sh` and
`android/gradlew assembleRelease`, or `ios/build-ipa.sh`.
