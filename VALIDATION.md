# Phone install readiness validation — 2026-10-04

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

npx eas-cli@latest whoami exited 1: Not logged in. No linked extra.eas.projectId exists. No authenticated build was submitted, no credentials guessed, and no account created. Android preview already targets APK/internal distribution; iOS preview targets internal distribution. No APK/IPA or build/artifact URL exists. Apple credential availability cannot be inspected without EAS authentication; iOS signing and registered-device installation remain unconfirmed. This Windows session has no physical phone access.

Next user action: `npx eas-cli@latest login` with an existing Expo account. Then `npx eas-cli@latest init` to select/create the intended project, `npx eas-cli@latest build --platform android --profile preview`, and, with Apple signing/device registration available, `npx eas-cli@latest build --platform ios --profile preview`. Do not submit to stores. See README for acceptance steps and official EAS setup links.

## Not yet confirmed

Physical Android/iPhone camera detection, permission recovery, torch, keyboard/small-screen layout, native startup and installation have not been tested. Run every README acceptance item separately on Android and iPhone; record device/OS, commit and result. No hardware or native-build success is claimed. Exact PR head and GitHub CI result are supplied in the PR handoff.
