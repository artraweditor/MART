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

Light, Color, Tone and Crop tabs (exposure, white balance with a neutral-gray picker, contrast and base curve,
saturation, crop with ratios, quarter turns, flips and straightening), undo/redo, Save (the standard `.arp`
sidecar), a **Look** sheet to apply a saved ART profile (bundled, yours, or one from the device), and an **Info**
sheet with the image summary and all its metadata. Opening another image never drops unsaved edits silently.

## Tests

    cd host && ctest --test-dir build                  # patch serialiser, key allowlist
    cd client && npm test                              # patch helpers, crop geometry (after npm run build)
    host/tests/run_e2e.sh /path/to/photo.arw           # live channel, profiles, geometry, Save (fresh copy of the image)
    # browser tests (headless Chrome), with a host running on a COPY of an image (Save writes its sidecar):
    node host/tests/ui_smoke.mjs http://localhost:8080 /tmp           # sliders, undo
    node host/tests/ui_m3.mjs http://localhost:8080 /tmp /path/copy.arw   # crop drags, sheets, white balance, Save
    MART_CMD='host/build/mart ... photo.arw' node host/tests/ui_reconnect.mjs

## Needs ART's `apply --merge`

One history entry per slider drag needs the `apply --merge KEY` option of ART's server mode
(see `doc/server_mode.md` in ART). Without it every step of a drag is an undo step.
