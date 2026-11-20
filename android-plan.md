# MART on Android: build plan

## Status (2026-11-19): milestones 1-4 done on the emulator, 5 partly

Done and checked on the Android 17 (API 37) arm64 emulator `mart_a37`:
- Tools: NDK r30 (Homebrew cask), SDK in `/opt/homebrew/share/android-commandlinetools` (platform 37.0, build-tools 37.0.0, emulator, `google_apis;arm64-v8a` image, `platform-tools` linked in), JDK 21, Gradle 9.9.1 wrapper, AGP 9.5.1. NDK `hello` with static OpenMP runs on the emulator.
- Shared build (`native/`): `build-deps.sh <ios|android> <slice>`, `build-libart.sh`, `platform/{ios,android}.sh`, `versions.sh`, `patches/` (+ `patches/ios/`), one source cache `native/src`. The `ios/` scripts are wrappers. Deviations from the plan above: outputs stay per platform (`ios/deps/{prefix,build,logs}`, `android/deps/...`) and each platform keeps its toolchain file next to them (`ios/deps/toolchain-ios.cmake`, `android/deps/toolchain-android.cmake`), because moving the iOS prefix would break the paths inside its `.pc` files. iOS checked: the same cmake caches, meson cross file and configure lines for zlib/png/jpeg/expat/lcms/fftw/ffi, and the same libART cache (only `lib/../include` spelled `include`).
- Dependencies for Android: all steps built (glib uses its `proxy-libintl` fallback and a static GNU libiconv, so `minSdk 26` works; OpenMP is the NDK's static `libomp.a`; no patches were needed).
- libART: `android/build/libart-arm64/src/libart/libART.so` (arm64, 16 KB aligned, only libm/libdl/libc needed, 30 `ART_*` exports, no change in `~/src/ART`). `android/smoke/run-smoke.sh IMAGE`: open/preview/export on the emulator, preview within 8/255 of the iOS one.
- Host: builds for Android unchanged (`host/CMakeLists.txt` got `MART_EMBED`, next to `MART_IOS`). `android/jni` (libmart.so), `android/build-native.sh`, Gradle app `android/app` (Kotlin: `MainActivity`, `Host`, `Assets`, `FolderStore`), client bridge in `client/src/native.ts` (iOS and Android behind the same functions; typecheck and the 60 client tests pass). The app starts the host, the page loads, a raw opens and renders with its sidecar.
- e2e: `android/e2e-emu.sh IMAGE` (debug build, intent extras `MART_E2E_PORT`, `MART_OPEN`, `MART_EVAL`; port 8081 so that it does not clash with the iOS simulator app on 8080). Image `~/src/ART/build/test.arw` + its `.arp` (the tests expect a sidecar with a Smoothing region). `ws_e2e` and `tools_e2e` pass. `export_e2e` passes up to "the server's folder is not revealed when files are only for download", which cannot hold for an app that sets `--export-dir` (same on iOS). `api/dng/srgb/luts/profiles_e2e` need a filesystem shared with the host and do not run against a device.

Checked by hand on the emulator (milestone 5, screenshots driven with `adb input`): the page detects the app (`native.ts`); Open lists "MART (this device)" with a thumbnail (made by `ThumbnailUtils` at that time; now `/api/thumbnail`, not yet re-checked on the emulator); "Choose another folder" -> asks for all-files access in Settings (`appops set us.pixls.mart MANAGE_EXTERNAL_STORAGE allow` does it for tests) -> the system folder picker -> the folder and its images are listed and opened in place; Save writes the `.arp` next to the original (`/sdcard/Pictures/mart-test/test.arw.arp` changed); Export (about 1 minute for 24 MP on the emulator) -> the system "Save as" picker -> a 3124x4684 JPEG with its EXIF in the chosen folder; `am kill` of the backgrounded app and relaunch -> new process, new host, page loads (the open image is not restored, as on iOS). Memory after an export: about 550 MB PSS. The page's wording is now "folder on this device" (client change, both platforms).

Added 2026-11-20 (checked on the emulator): the Open sheet lists the device's **Pictures** and **Camera (DCIM)** folders (with a button to give the all files access when it is missing: the bridge command `requestAccess`, the field `needsAccess` of a folder), and **Received** (copies). The app is an "Open with" and "Send to" target: `AndroidManifest.xml` has VIEW filters (`image/*`, and `*/*` with the raw extensions in both cases) and SEND/SEND_MULTIPLE (`image/*`, `application/octet-stream`); `ExternalFile.kt` edits the file in place when its address maps to a file that can be read (file:, the external storage and downloads documents, MediaStore; needs the all files access) and otherwise copies it to `Images/Received` (the same picture sent again keeps its sidecar). `MainActivity` hands the path to the page as the window event `mart-open` (cold start: after the page has loaded; the client waits for its first `start()`). Checked: cold and warm VIEW with a file: and a content: address (in place), SEND of a file with access denied (copy; reading failures do not crash). Not checked: real file managers' grants (adb's `--grant-read-uri-permission` is refused for media/documents URIs on this emulator).
On iOS (compiles; not run yet): `CFBundleDocumentTypes` (raw, JPEG, TIFF, PNG; "Open in MART" from Files and the share sheet, the file is copied to `Documents/Images/Received` by `ExternalFile.swift`), and "Import from Photos…" (the library's own picker, no permission needed; copies go to `Documents/Images/Photos`).

Not done yet: the Pixel 7a (milestone 6); the in-process path where the process lives but the host died (`onResume` -> `isAlive` -> restart) was not exercised; no Android twin of `ios/smoke/memtest.mjs`.

## Context

The iOS port (see `ios-plan.md`, `ios/`) runs MART as a native shell around a web view: the C++ host is compiled in and
listens on loopback, the unchanged TypeScript client is shown in a `WKWebView`, and libART (the ART engine with all its
dependencies linked in statically, OpenMP, OCIO and CTL included) is loaded by the host with `dlopen`. Android uses the same
design:

```
Android app (Kotlin, ~300 lines)
 ├─ WebView  ->  http://127.0.0.1:<port>/?token=...   (the existing client)
 ├─ libmart.so: JNI shim + the MART host (static lib), host started on a background thread (mart_run/mart_stop)
 └─ libART.so (engine + all dependencies statically inside), loaded by the host with dlopen() from nativeLibraryDir
```

Decisions taken (from you):
- **Share the common parts** of the iOS and Android builds (dependency script, versions, patches, libART/host CMake) instead of copying them.
- **Emulator only for the first pass**; the Pixel 7a comes after.
- **Test device**: Pixel 7a (Tensor G2, arm64), Android 17. Stay compatible with older versions: `minSdk 26` (Android 8.0), `compileSdk`/`targetSdk` = what the installed SDK platform offers (to be checked at milestone 1; Android 17 is API 37 only if the SDK manager lists it).
- ABI: **arm64-v8a only** (the emulator image is arm64 as well; this Mac is Apple silicon). No x86_64, no 32-bit.

### What is already here / not here (checked on this Mac)
- Not installed: Android SDK/NDK, `adb`, `sdkmanager`, `gradle`. Java is 26 (`/usr/bin/java`): Android Gradle Plugin wants JDK 17-21, so I install `openjdk@21` with Homebrew and use it only for the Android build (`JAVA_HOME` in the scripts).
- Disk: 375 GB free. Estimate: SDK + NDK ~4 GB, arm64 emulator image ~3 GB, dependency sources shared with iOS, dependency builds ~4 GB, libART ~2 GB: **~13 GB**.
- `host/src` has `__APPLE__` code only in `libart_dyn.cc` (library name/extension for `dlopen`; Android takes the non-Apple branch, `libART.so`); the temp-dir (`$TMPDIR`) and embeddable-entry-point (`mart_run`) work of the iOS port is already in place.

### Findings that shape the plan
- **OpenMP is easier than on iOS**: the NDK ships `libomp.so` (clang `-fopenmp -static-openmp` links a static copy), so no llvm-project checkout is needed.
- **glib on Android** (bionic): no libintl and, below API 28, no iconv. Plan: build GNU `libiconv` and `gettext-runtime` (libintl) statically, as for iOS `step_ffi`/gettext, which keeps `minSdk 26` possible. If this drags too much, the fallback is `minSdk 28` (decide at the glib step, not before).
- **Files**: the Storage Access Framework returns `content://` URIs, not paths, and libART/LibRaw need real paths and write the `.arp` sidecar next to the image. For iOS the app keeps security-scoped access to the chosen folder; Android has no equivalent. See *Open point 1*.
- **16 KB page size**: Android 15+ requires apps to work on 16 KB pages; all `.so` files are linked with `-Wl,-z,max-page-size=16384` (and `-Wl,-z,common-page-size=16384`) from the start, with NDK r28 or newer where this is the default.
- `dlopen` of an absolute path in `nativeLibraryDir` works from an app if the libraries are extracted: `android:extractNativeLibs="true"` (manifest) and `packaging { jniLibs { useLegacyPackaging = true } }` (Gradle).
- APK assets are not files: `art-data` (hundreds of MB?) and `www/` are copied to `filesDir` on first run (and when the app version changes); the host gets plain paths, as on iOS. A stamp file marks a complete copy.

## Part A: what I need from you
1. **Permission to `brew install`**: `openjdk@21`, `--cask android-commandlinetools` (gives `sdkmanager`), `android-platform-tools` (`adb`). Gradle comes from the project's wrapper (`gradlew`), no system install. Then the Android SDK itself (platform, build-tools, NDK r28+, emulator, arm64 system image) is installed by `sdkmanager` into `~/Library/Android/sdk` (no sudo, ~7 GB, reclaim with `rm -rf`). *Needed at milestone 1.*
2. **Android Studio**: not needed (everything is command line, like for iOS). Say if you want it anyway for debugging.
3. **Pixel 7a** (later, milestone 6): enable Developer options + USB debugging, connect over USB, accept the RSA prompt; `adb devices` must list it. Nothing needed now.
4. Answers to the *open points* at the bottom.

## Part B: shared build infrastructure (refactor of `ios/`, no behaviour change for iOS)

Goal: one dependency/libART/host build driven by a small per-platform file, instead of a second copy of ~300 lines.

New layout (top-level `native/` is my suggestion; the name is open):

```
native/
  versions.sh                  # moved from ios/deps/versions.sh (the same pins)
  build-deps.sh <platform> <slice> [step...]      # the step_* functions, platform-neutral
  platform/ios.sh              # SDK/TGT/CC/AR/..., meson cross file, autotools --host, toolchain file, extra flags
  platform/android.sh          # NDK clang (aarch64-linux-android26-clang), llvm-ar, meson cross, --host=aarch64-linux-android
  toolchain/ios.cmake          # moved from ios/deps/toolchain-ios.cmake
  toolchain/android.cmake      # wraps $NDK/build/cmake/android.toolchain.cmake (ABI arm64-v8a, platform 26, STL c++_static) + the find-root-path rules of the iOS file
  patches/                     # moved from ios/deps/patches (names are per dependency; platform-specific ones get -ios-/-android- in the name)
  src/                         # one download cache for both platforms
  build/<platform>-<slice>/ prefix/<platform>-<slice>/ logs/ ...
  build-libart.sh <platform> <slice> [target...]  # cmake line of ios/build-libart.sh, platform flags from platform/*.sh
ios/    build-deps.sh, build-libart.sh, build-app.sh, ...   # thin wrappers that call native/*, same command lines as today
android/ (new: Gradle project + wrappers)
```

- Steps stay the same names (`step_zlib`, ..., `step_ocio`); what differs per platform (the `meson_cross` heredoc, `autotools_dep` host triple, ffi's configure line, `step_omp`, linker flags such as `-force_load` vs `--whole-archive`) moves into `platform/<p>.sh` hooks.
- **iOS must not regress.** Verification after the refactor: (1) `ios/deps/build-deps.sh simulator zlib png` (cheap steps) and a dry-run diff of the generated cmake/meson/configure command lines before vs after; (2) `ios/build-libart.sh simulator` reconfigures to an identical `CMakeCache.txt` (apart from paths); (3) `ios/smoke/run-smoke.sh` and `ios/e2e-sim.sh` green. A full dependency rebuild for iOS is not needed unless a diff shows a change. The existing `ios/deps/prefix` and `ios/build` are moved (not rebuilt) or kept via symlinks.
- The same pass moves the host static-library CMake target and the data install (`libart_data`) so both platforms use them as they are.
- New `hg add` of the new files only after you review the layout.

## Part C: dependencies for Android (`native/build-deps.sh android arm64`)

Same list and order as iOS (zlib, png, jpeg-turbo, tiff, expat, lcms2, fftw3f, libffi, pcre2, glib, sigc++, glibmm, lensfun, exiv2, LibRaw, Imath, libdeflate, OpenEXR, CTL, yaml-cpp, pystring, minizip-ng, OpenColorIO), plus:
- **libiconv, gettext-runtime (libintl)** before glib (see findings); glib is configured with `-Diconv=external -Dnls=disabled` against our static libiconv, `-Dlibmount=disabled`, `-Dselinux=disabled`, and possibly a small patch for bionic (`glib-0001-android-*.patch`; expected places: `gio` unix mount/`libmount`, `getgrouplist`, `fexecve`; known to be buildable since GTK/GStreamer have Android builds).
- `step_omp` on Android = nothing to build; the libART link uses `-fopenmp -static-openmp` (static libomp from the NDK).
- libffi: `--host=aarch64-linux-android26`; fftw3f with NEON; LibRaw/exiv2/lensfun as on iOS.
- Android-specific flags for all: `-fPIC -O2 -fno-emulated-tls`-free default, `-D__ANDROID_API__=26`, 16 KB linker flags above.
- Risks: glib/glibmm/lensfun/exiv2 patches (probably fewer than iOS); mmap/`posix_memalign`/locale oddities in bionic show up only at run time and are caught by the smoke test.

## Part D: libART for Android (`native/build-libart.sh android arm64`)

Same cmake line as `ios/build-libart.sh` (GUI/CLI off, `ART_BUILD_LIBART=ON`, `ART_LIBART_EMBED=ON`, OCIO/CTL/OpenMP on, Vulkan/mimalloc off, `ENABLE_LIBRAW=ON`, `libart_data` + lensfun DB) with:
- `-DCMAKE_TOOLCHAIN_FILE=native/toolchain/android.cmake` (CMake sees `ANDROID=1`, `UNIX`, not `APPLE`).
- Link: `-Wl,--whole-archive libglib-2.0.a libgobject-2.0.a -Wl,--no-whole-archive` (the `-force_load` equivalent so the glib constructors run first), `-Wl,--exclude-libs,ALL` plus the existing `art.exports` as a version script, `-static-openmp`, `-llog -landroid` only if needed.
- **ART changes** (in `~/src/ART`, small, to be shown to you as a diff before I commit anything there): the CMake has Apple blocks guarded by `APPLE AND NOT IOS`; Android goes through the generic Linux paths, which may need guards for glibc-only code (`execinfo.h`/`backtrace`, `malloc_trim`, `/proc` or `sysconf` assumptions, `std::filesystem` needs API 26+ which we have). I report the actual list after the first configure/compile, as I did for iOS Part B.
- Output `libART.so` (+ `art-data` from the existing `libart_data` component, identical to iOS, so it is built once and shared).
- **Smoke test without the app**: `art_cmd`/embed test cross-built for Android, pushed with `adb push` to `/data/local/tmp` on the emulator and run with `adb shell` (`ART_DATA_DIR` set): `open test.arw`, `preview` to JPEG, export, compared with the desktop and iOS output. This separates engine problems from app problems, as on iOS.

## Part E: host (`host/`, small)

- Host static library for Android built from the same CMake target as for iOS (cpp-httplib is header-only, no other dependency). Any bionic incompatibility is expected to be trivial (the host builds on macOS and Linux today).
- `libart_dyn.cc`: nothing for Android (`dlopen` of the absolute path given by `--library`); keep the lookup of the file name consistent (`libART.so`).
- `$TMPDIR` is set by the app to `cacheDir` (JNI `setenv`) before `mart_run`.
- Run `mart_run` on a pthread with an 8 MB stack (as for iOS); started from a Kotlin thread through JNI.

## Part F: the Android app (`android/`, Gradle Kotlin DSL)

- `app/src/main/cpp/mart_jni.cc` + `CMakeLists.txt` (built by AGP's `externalNativeBuild`): `libmart.so` = JNI shim (`startHost(args, callback)`, `stopHost()`, `addRoot(dir)`) + host static lib; links `log`. `libART.so` is copied into `jniLibs/arm64-v8a/` by a Gradle task that calls `native/build-libart.sh android arm64` (or checks that its output exists).
- `MainActivity` (single, full-screen `WebView`, edge-to-edge, `configChanges` for rotation/size so the host and page survive them): copies assets to `filesDir` if the stamp differs, starts the host (`--listen 127.0.0.1 --port 0 --require-token --token <random> --www <files>/www --data <files>/art-data --library <nativeLibraryDir>/libART.so --root <images> --profiles <files>/profiles --luts <files>/luts --export-dir <cache>/exports`), waits for the ready callback, then `loadUrl("http://127.0.0.1:<port>/?token=<token>")`.
- `AndroidManifest`: `INTERNET` (loopback), `android:networkSecurityConfig` allowing cleartext only for `127.0.0.1`, `extractNativeLibs=true`, `android:largeHeap` not needed (native memory), `android:hardwareAccelerated=true`, `android:usesCleartextTraffic` not set globally. `MANAGE_EXTERNAL_STORAGE` only if *Open point 1* chooses it.
- `WebViewClient.shouldOverrideUrlLoading` refuses any origin other than the host's (the JS bridge below is exposed to the page).
- **Bridge** (Part G has the client side): `@JavascriptInterface fun post(id: String, json: String)`; Kotlin handles `folders`, `pickFolder`, `saveFile` (the same commands as `ViewController.swift`) and answers with `webView.evaluateJavascript("window.__martNativeReply(id, json)")`.
  - `pickFolder`: `ActivityResultContracts.OpenDocumentTree` -> persistable permission -> path (see *Open point 1*).
  - `saveFile(path)`: `ActivityResultContracts.CreateDocument` with the file's MIME type, copy the exported file into the returned URI (replaces `UIActivityViewController`/Save to Files).
  - thumbnails are not a bridge command: the page asks the host (`/api/thumbnail`, libART's `thumbnail --no-profile`).
  - Browser `<a download>`/blob downloads (if any remain): `DownloadListener` + `DownloadManager`-less direct copy of the loopback URL to a CreateDocument target.
- **Lifecycle**: Android can freeze or kill the process in the background. On `onResume`, if `GET /api/status` fails, `stopHost` + `startHost` and reload (the client already shows a reconnect overlay). A foreground service is *not* planned for the first pass (exports happen with the app in front); revisit if long exports are killed.
- **Back button**: close the topmost sheet via the page (`history`/a `back` message) before leaving the app.
- Build: `android/build-app.sh [debug|release]` -> `gradlew assembleDebug` (JDK 21 forced), debug keystore (automatic); `adb install -r`. No Play-Store signing in scope.
- `minSdk 26`; no use of API-30+ only calls without `Build.VERSION.SDK_INT` guards; Kotlin only (no Compose, no AndroidX beyond `androidx.activity`/`webkit` if needed).

## Part G: client change (the only one)

`client/src/native.ts` currently finds the bridge only at `window.webkit.messageHandlers.mart`. Change `handler()` to return a common `postMessage(msg): Promise<unknown>` from either:
- iOS: unchanged;
- Android: if `window.martAndroid` (the `@JavascriptInterface` object) exists, wrap `post(id, json)` in a promise stored in a map and resolved by `window.__martNativeReply(id, json)`.

`isNative()` is true for both; every exported function (`nativeFolders`, `nativePickFolder`, `nativeThumbnail`, `nativeSaveFile`) is unchanged. Desktop browsers: no change, still `false`. Touch/layout details of Chromium WebView (safe areas via `env(safe-area-inset-*)`, `100dvh`, overscroll/pull-to-refresh, text autosizing, pinch zoom) are follow-ups found on the emulator/device.

## Part H: emulator and tests

- AVD: `system-images;android-<API>;google_apis;arm64-v8a` for a recent API level (the one matching `targetSdk`, or API 34-35 if 37 is not offered) with a tablet-ish and a phone profile (Pixel 7a-like: 1080x2400, 6 GB RAM, 4+ cores, 6 GB data), created with `avdmanager`; started headless/windowed with `emulator -avd ... -no-snapshot`.
- `android/e2e-emu.sh IMAGE.arw`: `adb install`, `adb push IMAGE.arw` into the app's images folder (`run-as`/`/sdcard`), `adb shell am start --es MART_E2E_PORT 8080 --es MART_OPEN <path>` (debug extras, like the iOS env vars; debug builds only), `adb forward tcp:8080 tcp:8080`, then the existing `host/tests` e2e scripts (`ws_e2e`, `export_e2e`, `tools_e2e`, `luts_e2e`, `profiles_e2e`, `srgb_e2e`, `api_e2e`) against `localhost:8080`; screenshots with `adb exec-out screencap -p`. `ios/smoke/memtest.mjs` has an Android twin using `dumpsys meminfo <pid>` instead of the process footprint.

## Milestones (each ends with something you can check)

1. **Tools + shared build refactor.** brew installs and `sdkmanager` (Part A.1); the `native/` refactor (Part B) with iOS verified as described. *You see:* the layout diff, the iOS smoke/e2e still green, `sdkmanager --list_installed`, a trivial NDK clang hello-world run on the emulator.
2. **Dependencies for Android** (Part C, steps 1-5 then OpenMP/OCIO/CTL). *You see:* `prefix/android-arm64/lib/pkgconfig` contents and the log of each step; patches listed.
3. **libART for Android + engine smoke test on the emulator** (Part D). *You see:* the preview JPEG of `test.arw` next to the desktop one; list of ART source changes.
4. **Host library + JNI + app skeleton + client bridge** (Parts E-G): the app starts on the emulator, host up, page loads. Host `ctest` still green on macOS; `npm run build` and the client unit tests still green. *You see:* an emulator screenshot of the editor with the test image.
5. **e2e suite against the emulator app** (Part H) and the file flows (open from the images folder, pick a folder, export/save to Files-equivalent, restart after background kill). *You see:* e2e output, screenshots of the pickers.
6. **Pixel 7a**: `adb install`, check it on Android 17 (permissions, picker, WebView version, performance with OpenMP, memory), compare with the emulator. *You see:* the app running on the phone. Tuning (touch details, memory limits, foreground service if needed) is a separate request.

## Open points (for your review)

1. **File access** (the main design decision). Options:
   - **A. All-files access** (`MANAGE_EXTERNAL_STORAGE`): real paths under `/storage/emulated/0/...`, images edited in place with the `.arp` sidecar next to them, the same behaviour as iOS. The user grants it once in Settings; works for sideloading (the Play Store restricts it, out of scope as for iOS). The folder picker still uses the system tree picker and converts `primary:Pictures/x` to `/storage/emulated/0/Pictures/x` (`<UUID>:...` -> `/storage/<UUID>/...` for SD cards).
   - **B. Import by copy** into the app's own folder (SAF only, no special permission): simpler and Play-friendly, but edits and sidecars stay in the copy and must be exported back.
   - My recommendation: **A first**, B as the fallback when the permission is not granted (the app's own folder always works).
2. **minSdk 26 vs 28**: 26 if libiconv/libintl build cleanly (preferred), 28 if they do not.
3. **Folder name**: `native/` for the shared infrastructure, or keep `ios/deps` as the home and add `android/` beside it that points into it?
4. **libomp**: static OpenMP from the NDK (`-static-openmp`) is my default; the shared one would be a second `.so` to ship. OK with static?
5. **x86_64 emulator slice**: not planned (Apple silicon). Say if you need it for CI.

## Risks

- Dependency cross-builds (glib, glibmm, lensfun, exiv2, LibRaw) on bionic: patches likely but fewer than on iOS.
- The refactor of the iOS scripts could break the working iOS build; mitigated by the verification in Part B and by keeping the old command lines as wrappers.
- Memory: Android's low-memory killer with large raws on the phone (no equivalent of the iOS memory entitlement; the phone has 8 GB).
- WebView version differences between devices (Chromium-based, updated through Play).
- Android may freeze the app in the background (WebSocket dies): same reconnect + host restart as on iOS.
- Licensing: as for iOS, GPL/LGPL code, fine for sideloading and personal testing only.
