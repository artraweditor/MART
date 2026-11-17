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
`--socket PATH` uses a running `ART-cli --server` instead of the in-process engine.

## What it does

Tone, Color, Detail and Crop tabs (exposure and highlight recovery, a haze removal slider (ART's dehaze with a straight
strength curve, in RGB mode), contrast, base curve, a point-curve editor, tone
equalizer; white balance with a neutral-gray picker, saturation, channel mixer (primaries mode), soft light; lens
correction from the automatic or embedded data, and the flat field embedded in the raw file (DNG gain maps, on by
default for a DNG that has no saved choice), capture sharpening by Richardson-Lucy deconvolution, film grain and
halation; film simulation with a LUT (a folder of the server's, or a file from the device, including CTL scripts with
their parameters); crop with ratios,
quarter turns, flips and straightening), an Other tab that lists, read-only, the tools of the profile that have no
controls here (they are kept on Save), undo/redo, Save (the standard `.arp`
sidecar), a **Look** sheet to apply ART's built-in Neutral or Default profile, or a saved one (bundled, yours, or from the device), and a **⋯** menu
with **Export** (JPEG, PNG or TIFF at full size or resized to 1920, 2560 or 3840 px, then a download), the image information and metadata, and opening
another image. Opening another image never drops unsaved edits silently.

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
    node host/tests/ui_overflow.mjs http://localhost:8080 /tmp        # no sideways scrolling on phone widths
    node host/tests/ui_srgb.mjs http://localhost:8080 /tmp            # the preview stays sRGB whatever the profiles say (fresh host)
    node host/tests/srgb_e2e.mjs http://localhost:8080 /path/copy.arw   # exports are sRGB (a COPY: it rewrites its sidecar)
    node host/tests/ui_panel.mjs http://localhost:8080 /tmp           # the floating panel on a phone
    node host/tests/ui_resize.mjs http://localhost:8080 /tmp          # the picture stays fitted when the view changes
    MART_CMD='host/build/mart ... photo.arw' node host/tests/ui_reconnect.mjs    # server away and back
    MART_CMD='host/build/mart ... photo.arw' node host/tests/ui_pwa.mjs          # manifest, service worker, offline start

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
the same document); without it a LUT can still be chosen but its parameters are not shown. LUTs are offered from `DATA/luts`, `DATA/ctlscripts`,
ART's user `luts` folder and `--luts DIR`.
