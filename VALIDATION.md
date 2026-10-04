# Offline catalog validation — 2026-10-04

Base: `77c82d26a6d2f83813fcb834a4183e8e66aed68b`, fetched from live origin/main before work and again before final validation. This phase adds only bundled ISBN metadata and provider-failure fallback. Existing conditional screen flow, provider merging, scan gate, camera and session-cache behavior are retained. No new navigation or future product features.

## Catalog and automated evidence

- Expo-compatible `expo-sqlite ~57.0.3`; SDK 57 SQLiteProvider imports the bundled `.db` into a separate versioned catalog database. ISBN-13 is the WITHOUT ROWID primary key; lookup uses a bound parameter. No user tables or writes.
- Source: checked-in Open Library search/seed snapshot plus two explicitly sourced series/standalone annotations in `catalog/curated.json`. Generation uses Python standard library and does not need internet unless `--refresh` is explicitly selected.
- 1,106 distinct Open Library works (books), 7,916 unique ISBN-13 rows. Raw SQLite: **823,296 bytes**; gzip level 9 with mtime 0: **191,226 bytes** (not shipped compressed). Mean **104.004 bytes per ISBN row**, including indexes and metadata. Snapshot JSON: 478,700 bytes.
- Catalog SHA256: `b54cdd273c17760cd18629d6914632b32985897837697f9014115351d11aa2b8`. Metadata version `v1`, generated date `2026-10-04` (UTC), source `https://openlibrary.org/search.json`.
- Rough warm local lookup: **0.08–0.10 ms/query** across 10,000 parameterized ISBN queries using local Python 3.14/SQLite on Windows. This is a local database measurement, not emulator/native bridge latency or end-to-end provider-fallback latency. No large-catalog extrapolation.
- TypeScript tests: **40/40 passed**, including local hit/miss, malformed rows, missing cover/rating, rating normalization, conservative series, actual adapter failure simulations, both providers failing with local hit/miss, timeouts, online success and partial success precedence.
- Python tests: **3/3 passed** in about 0.2 seconds. Tiny duplicate/ISBN-10/ISBN-13 fixture, whitespace/authors, explicit/ambiguous series rules matching the online adapter, metadata, deterministic rebuild, primary-key query plan, bundled integrity check, seed assertions, and full semantic comparison with regeneration. No live internet in tests.
- Typecheck and Expo lint passed. SDK dependency check passed. Expo Doctor **21/21 passed**. Expo config introspection passed; no manual native changes. Existing light-theme expo-system-ui advisory remains.
- Final Android export passed (637 modules); iOS export passed (639 modules), both bundling the 823,296-byte catalog. These are JS/asset exports, not an iOS native build or simulator run.
- Fast CI adds only local Python catalog checks to existing tests/typecheck/lint/dependency checks. No emulator/native builds or dataset downloads.

## Android executable acceptance

Pixel_9_Pro AVD, Android 17/API 37, x86_64, 1280 × 2856. Generated native files through Expo prebuild only; built standalone release APK with `npx expo run:android --variant release --no-bundler` and process-local Android SDK/JBR paths. Native build succeeded; generated debug signing is for local acceptance. APK is in ignored `android/app/build/outputs/apk/release/app-release.apk`. No EAS credentials or store release used.

Online, real providers on the installed app:

- `9780140328721`: Fantastic Mr. Fox / Roald Dahl, visible cover, Open Library 4.0 / 121 ratings.
- Scan Another returned to scanner; `9780765326355`: The Way of Kings / Brandon Sanderson, visible cover, Open Library 4.5 / 166 ratings.
- Both preserve Google's live rate-limit warning and online unknown-series status; neither displays Offline catalog. Live Google success remains unconfirmed; mocked success/merge coverage passes.

Genuine offline condition: `adb shell svc wifi disable` and `adb shell svc data disable`, then confirm settings 0/0, **Active default network: none**, and an upstream probe reporting **Network is unreachable**. Force-stop/relaunch clears the session cache before offline lookup; all results below came from bundled SQLite rather than live APIs or a mocked UI.

| ISBN | Observed offline result |
| --- | --- |
| 9780140328721 | Fantastic Mr. Fox; Roald Dahl; 4.0 / 121; unknown series |
| 9780765326355 | The Way of Kings; Brandon Sanderson; Stormlight Archive · Book 1; 4.5 / 166 |
| 9780765320308 | Warbreaker; Brandon Sanderson; Standalone book; 4.3 / 23 |
| 9780140430776 | American notes; Charles Dickens, Diana C. Archibald; Not rated; unknown series |
| 9780547928227 | The Hobbit; J.R.R. Tolkien; 4.3 / 500; unknown series |
| 9791032300336 | Clear Internet unavailable / ISBN not in offline catalog message; scanner/manual controls retained |

All five show the Offline catalog/stored-ratings label, Cover unavailable placeholder and reachable Scan Another. Scan Another returned to scanner between lookups. Warbreaker additionally passed after clearing all emulator app data and launching while offline: first-run asset import required no internet. Manual entry works with camera permission absent. Screenshots and UI hierarchy text captures are retained locally in ignored `dist/acceptance/`. Targeted AndroidRuntime/ReactNativeJS error logs were empty.

## Limits

The offline catalog is deliberately small and incomplete. Search rows use work-level titles/authors, which can differ from edition/language details of ISBN variants; seven exact edition seeds have more precise source records. Missing series stays unknown except for explicit evidence; no offline cover images are shipped. Stored ratings change over time. Provider-first fallback can wait for existing deadlines (~10–11 seconds with stalled requests), and the existing five-minute session cache can retain a clearly labeled offline result after reconnecting.

iOS config/export passed on Windows; macOS/iOS Simulator was unavailable. Physical Android/iPhone testing remains deferred and does not block this phase. No physical barcode capture is claimed. Recommended next phase: improve edition-level catalog metadata and expand bounded emulator regression coverage before increasing catalog size.

---

# Earlier emulator/simulator install readiness validation — 2026-10-04

Base: `25b740f859c6e3413698eeb475f79be9463bba2e` (merged PR #2). Live origin/main was fetched before work. This phase adds no product features or dependencies and leaves fast CI unchanged.

## Audit and fixes

Reviewed app/EAS configuration, SDK 57 dependencies, App and both screens, scan gate, cache, provider adapters, environment handling, README and CI against SDK 57 documentation. Retained synchronous duplicate protection, camera unmount during lookup/result/error/background, permission refresh on return, bounded provider calls and scrollable results with wrapping text/cover fallback. Existing conditional screen flow was preserved; no navigation migration.

- Enabled iPhone camera autofocus explicitly (SDK 57 defaults to off), to help focus physical barcodes at different distances.
- Enabled iOS ScrollView keyboard insets and drag dismissal so manual entry and lookup stay reachable. Android native introspection confirms adjustResize. SafeAreaView bounds both screens; hardware keyboard/layout acceptance remains pending.
- Disabled the unused iOS microphone description through expo-camera's installed plugin (supports false); Android audio permission was already disabled.
- Removed unrestricted iOS ATS loads through app config. All provider requests and accepted cover URLs use HTTPS.

## Confirmed local checks

- npm ci: passed; lockfile unchanged. npm reports 23 existing toolchain findings (7 moderate, 16 high); no forced SDK changes.
- npm test: 32/32 passed. Includes duplicate gate, invalid ISBN, partial provider failure, cache, series ambiguity, bounded rate-limit retries and simulated abort/timeout behavior.
- npm run typecheck: passed.
- npm run lint: passed, no warnings.
- npx expo install --check: dependencies up to date for SDK 57.
- npx expo-doctor: 21/21 passed.
- npx expo config --type introspect: passed, including rerun after configuration changes. Both identifiers com.juvialski.bookmarkit; Bookmarkit display name; Android portrait/CAMERA/INTERNET, no RECORD_AUDIO, adjustResize and adaptive icon assets configured; iOS camera explanation, no microphone explanation, ATS arbitrary loads false. iPhone portrait and iPad support retained. Android light-theme expo-system-ui advisory is pre-existing.
- Android export: passed, 603 modules; iOS export: passed, 605 modules. Both are Hermes JS bundles in ignored dist/, not APK/IPA binaries.

## Live provider smoke

Two ISBNs, sequential, actual adapters without a key. Google returned typed rate-limit failures after its one bounded retry for both. Open Library returned Fantastic Mr. Fox / Roald Dahl (9780140328721), cover URL, rating 3.9504 / 121; The Way of Kings / Brandon Sanderson (9780765326355), cover URL, rating 4.5120 / 166. Both series unknown. Ratings are dated observations; covers were not visually verified. Google success, partial failure and explicit series are covered by mocks; live Google success remains unconfirmed. Timeout behavior is mocked, not an induced live outage.

## Native build blockers

npx eas-cli@latest whoami exited 1: Not logged in. No linked extra.eas.projectId exists. No authenticated build was submitted, no credentials guessed, and no account created. Android preview already targets APK/internal distribution; iOS preview targets internal distribution. No EAS APK/IPA or cloud build/artifact URL exists. A local APK was subsequently built; see emulator evidence below. Apple credential availability cannot be inspected without EAS authentication; iOS signing and registered-device installation remain unconfirmed. This Windows session has no physical phone access.

Next user action: `npx eas-cli@latest login` with an existing Expo account. Then `npx eas-cli@latest init` to select/create the intended project, `npx eas-cli@latest build --platform android --profile preview`, and, with Apple signing/device registration available, `npx eas-cli@latest build --platform ios --profile preview`. Do not submit to stores. See README for acceptance steps and official EAS setup links.

## Current acceptance boundary

For now, project acceptance is emulator/simulator-based. Physical Android/iPhone testing is intentionally deferred and is not a blocker for current phases. Android native installation/startup and selected flows have been tested on an emulator as described below. iOS validation is currently limited to configuration/export on this Windows environment; use an iOS Simulator when macOS is available. Hardware-only behaviors such as real barcode capture, actual torch illumination and Settings permission recovery remain future validation items.

## Android emulator follow-up

Built from app source at 2777bd4d8fca3a1b8331d0f57b1ebc9bf14cf6eb using `npx expo run:android --variant release --no-bundler`, with the installed Android Studio JBR/SDK supplied through process-local JAVA_HOME/ANDROID_HOME. Expo generated ignored android/; no native files were hand-edited. Restored the prebuild-generated package script changes. Gradle 9.3.1 and licensed NDK 27.1 were installed automatically; build succeeded (291 tasks, 13m27s). APK signature verification passed: generated Android Debug certificate, not EAS/release-account signing.

Local artifact: `C:\Users\Al\Documents\Codex\Bookmarkit-emulator\bookmarkit-local-release.apk`
SHA256: `882d47899fe3dc869184771bd7edefd65909d33254943ad5769d2fbde9b108f7`.

Pixel_9_Pro, Android 17/API 37, x86_64 emulator:
- Installed and launched standalone com.juvialski.bookmarkit; also cold-launched after stopping Metro.
- Manual lookup while camera permission absent: Fantastic Mr. Fox, Roald Dahl, visible cover, 4.0 rating/121 ratings. Google rate-limit warning preserved the Open Library result.
- Scan Another returned to scanner; second manual lookup displayed The Way of Kings, Brandon Sanderson, visible cover, 4.5 rating/166 ratings. Series unknown on both.
- Camera permission granted using ADB (not the Android dialog/Settings flow); virtual scene preview started.
- Torch toggle updated UI without crashing; background/return remounted virtual camera and reset torch.
- Invalid manual ISBN showed validation and left scanner usable.
- Result and controls fit the tested viewport; emulator input used the floating/hardware keyboard, so full software keyboard and small-phone acceptance remain pending.
- No AndroidRuntime/ReactNativeJS error entries observed in the targeted logcat read.

Screenshots retained locally in `C:\Users\Al\Documents\Codex\Bookmarkit-emulator\result.png` and `camera.png`. Physical barcode/duplicate detection, actual torch illumination, denial/Settings recovery, hardware network behavior and real-iPhone acceptance are deliberately deferred. They do not block the current emulator/simulator development phases. No physical camera success is claimed. EAS authentication/Apple signing blockers remain. Follow-up typecheck/lint passed; normal PR CI stays unchanged.
