# MART on iPad (simulator slice working; device slice not built yet)

Build order (all inside this folder; `rm -rf build deps/{build,prefix,src,logs}` reclaims the disk):

    deps/build-deps.sh simulator          # static dependencies  -> deps/prefix/simulator
    ./build-libart.sh simulator           # libART.dylib         -> build/libart-simulator
    cmake --install build/libart-simulator --component libart_data   # -> build/art-data
    smoke/run-smoke.sh IMAGE.arw          # open/preview/export on a booted simulator
    ./build-app.sh simulator              # host + client + ART.framework + app (MART/build/dd/...)
    ./e2e-sim.sh IMAGE.arw                # host/tests e2e scripts against the app (MART_E2E_PORT=8080)

Debug env vars (via `SIMCTL_CHILD_...`): `MART_E2E_PORT` (fixed port, no token), `MART_OPEN` (image to open).
Device: `deps/build-deps.sh device`, `./build-libart.sh device`, then `./build-app.sh device`
with `DEVELOPMENT_TEAM` set in `MART/project.yml`.

libART is built with OpenMP (static libomp from llvm-project, `deps/build-deps.sh <slice> omp`), OpenColorIO 2.5
and CTL (`ocio`, `ctl` and their dependencies; see `deps/versions.sh`); LibRaw is built with OpenMP too.
