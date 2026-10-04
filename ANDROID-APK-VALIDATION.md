# Android standalone test APK — 2026-10-04

Baseline: refreshed live `main`, `023de858ebe04e0db12e04f0851717cb17902f37`; GitHub confirms PR #6 merged with this commit. Product code, providers and catalog are unchanged in this phase. Only explicit Android versionCode, build automation, emulator acceptance and documentation were added.

## Artifact

- Filename: `bookmarkit-android-test.apk`.
- Local output: `C:\Users\Al\Documents\Bookmarkit\dist\bookmarkit-android-test.apk`.
- Gradle original: `C:\Users\Al\Documents\Bookmarkit\android\app\build\outputs\apk\release\app-release.apk`.
- Size: 101,860,186 bytes. SHA256: `defc669d97bdb5f4d005ad5a824dc9d5001c586f1f1204df112e27d5c0d97d71`.
- [Direct tested APK download](https://github.com/Juvialski/Bookmarkit/releases/download/android-test-2026-10-04/bookmarkit-android-test.apk). [Private-test prerelease](https://github.com/Juvialski/Bookmarkit/releases/tag/android-test-2026-10-04) targets `59366d9f3dc020a41547b7a32ff1ba8e2c91245a`; asset size verified using GitHub API.
- Display name Bookmarkit; package `com.juvialski.bookmarkit`; version `1.0.0` / code `1`; minimum Android API 24 (Android 7); target API 36.
- Universal native ABIs: arm64-v8a, armeabi-v7a, x86, x86_64.
- Signature verified using `apksigner`: generated Android Debug certificate. Private testing only.
- APK ZIP inspection: embedded `assets/index.android.bundle`; catalog packaged as `res/Zp.db`, byte-identical to checked-in 884,736-byte `assets/catalog-v2.db`. Android manifest contains CAMERA and INTERNET permissions, no microphone permission.

## Local checks

`npm ci`, TypeScript, Expo lint, 35/35 mobile tests, 20/20 backend tests, backend syntax check, 3/3 Python catalog tests, Expo dependency compatibility and Expo Doctor 21/21 passed. Expo public config resolves correctly. Existing dependency audit findings and the optional expo-system-ui advisory were not expanded into dependency changes.

`npm run build:android-test` generated native Android configuration through Expo Prebuild and completed Gradle `:app:assembleRelease`: **BUILD SUCCESSFUL**, 291 tasks, 5m22s. Node 24.19.0, Android Studio JBR 21.0.10, Android SDK build-tools 36.0.0 / NDK 27.1.12297006. No EAS credentials or cloud build required. Native folders and APKs remain ignored.

## Actual installed APK acceptance

Pixel_9_Pro emulator, Android 17/API 37, x86_64, 1280×2856. `python scripts/android-apk-smoke.py --adb C:\Users\Al\AppData\Local\Android\Sdk\platform-tools\adb.exe` installed the exact local artifact and cleared app data first. Screenshots/XML and `report.json` are retained in ignored `C:\Users\Al\Documents\Bookmarkit\dist\android-smoke\`.

- Install succeeded. Cold launch loaded main scanner with no Metro listening on port 8081; JavaScript/assets were loaded from the release APK. No ADB reverse or dev-server setup was used.
- Tapped Allow camera, accepted Android's **While using the app** dialog, and observed the virtual rear-camera preview and Torch on control. No camera permission/startup crash.
- Online manual ISBN `9780765326355`: The Way of Kings / Brandon Sanderson, visible downloaded cover, SERIES / The Stormlight Archive · Book 1, dominant Open Library 4.5 / 166 ratings.
- Goodreads button launched Chrome with `https://www.goodreads.com/search?q=9780765326355&search_type=books`, captured in Android activity intent evidence. This verifies the external redirect; it does not ingest Goodreads data.
- Disabled emulator Wi-Fi and cellular data. Confirmed `Active default network: none` via dumpsys connectivity; force-stopped and relaunched the app to discard its session cache.
- Offline `9780765326355`: useful catalog title/author, SERIES / Book 1, stored 4.5 / 166 rating. Offline `9780765320308`: Warbreaker / Brandon Sanderson, STANDALONE, stored 4.3 / 23 rating. Cover unavailable placeholder is expected offline.
- Restored Wi-Fi/data and cold-launched. `9780140328721`: Fantastic Mr. Fox / Roald Dahl, TYPE UNKNOWN, 4.0 / 121 ratings; online cover returned. Network restoration also runs in the smoke script's finally block.
- Targeted AndroidRuntime/ReactNativeJS error log was empty. Source inspection and existing tests confirm no Google Books runtime provider and no Goodreads scraping.

The first smoke run captured connectivity immediately after disabling interfaces; a second connectivity capture confirmed no active default network during offline acceptance. The checked-in harness waits for this condition before lookup.

## Distribution automation

Workflow **Android test APK**, `.github/workflows/android-test-apk.yml`: manual workflow_dispatch; Node 22.22.0, Temurin JDK 21, Android SDK, lockfile `npm ci`, checks, CNG, Gradle release APK and artifact upload. Optional repository variable `EXPO_PUBLIC_BOOK_API_BASE_URL` must be HTTPS. Dotenv loading is disabled for portable phone builds. No proxy is configured in the tested APK; Open Library and catalog fallback work.

The workflow also runs for PR changes to its own file/build script/app config, allowing premerge artifact validation. After merge, dispatch it on `main`. Artifact **bookmarkit-android-test** contains APK and SHA256, retained 30 days. Download from the successful run's Artifacts section and unzip. The initial setup action requested retired Android SDK package `tools`; corrected to `platform-tools`.

Verified successful [Actions build and artifact](https://github.com/Juvialski/Bookmarkit/actions/runs/37205249952/artifacts/11303834422), source `27bd909`. Downloaded the artifact and verified its checksum, signature and catalog. Actions APK is 101,860,186 bytes; SHA256 `631010c703406a2a3133bdede14937cb70b356ee5eecb76ec90140c1690a3929`. Its 1,292,860-byte Hermes JavaScript bundle and SQLite catalog are byte-identical to the emulator-tested local APK, and its signing certificate matches. APK container hashes differ between independent builds. Later source changes only improve build failure cleanup, smoke timing and documentation; mobile runtime/catalog/config stay identical.

## Limitations

Final physical-device acceptance is pending until the user installs the APK and scans a real ISBN. Emulator virtual-camera permission/startup is not real barcode scanning or real torch proof. No iOS signing/build distribution, Play Store signing/publishing, or authenticated live Hardcover acceptance was performed. Hardcover proxy support and server-only token boundary remain intact; no token was embedded.
