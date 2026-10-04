# Phase 1 validation — 2026-10-04

## Automated/local

- `npm test`: 13 focused fixture/mocked tests pass. ISBN prefixes/checksum, Google normalization and exact ISBN selection, Open Library normalization and conservative series, missing fields, either provider failing, not found/offline, synchronous duplicate lock/reset, HTTP errors, optional rating failure and request timeout.
- `npm run typecheck`: passes.
- `npx expo install --check`: dependencies match SDK 57.
- `npx expo-doctor`: 21/21 checks pass.
- `npx expo config --type introspect`: confirms iOS camera usage description and Android CAMERA permission; Android audio recording permission is absent.
- `npx expo export --platform all`: Android and iOS Hermes bundles exported successfully (602 / 605 modules). This is JavaScript bundling, not a native binary build.
- `npm audit --omit=dev`: 23 dependency findings (7 moderate, 16 high), including Expo/React Native CLI/build dependencies. No forced SDK downgrades applied.

## Live provider smoke checks

Direct adapter calls from Node on this machine, not from a phone:

| ISBN | Google Books | Open Library |
| --- | --- | --- |
| 9780140328721 | HTTP 429; adapter rejected safely | Fantastic Mr. Fox — Roald Dahl; cover URL; work rating 3.9504, 121 ratings; series unknown |
| 9780765326355 | HTTP 429; adapter rejected safely | The Way of Kings — Brandon Sanderson; cover URL; work rating 4.5120, 166 ratings; series unknown |

Ratings are time-sensitive. Cover URLs were returned; on-device image loading is not verified. The Google success path is covered by mocks, but live Google success is blocked by rate limiting from this environment. No API key was supplied or added.

`9791032300336` is used only as a synthetic checksum-valid 979 fixture, not a verified book lookup.

## Android / iOS status

Both targets have compatible packages, camera configuration and successful bundle exports. Neither target has a verified native binary build or on-device run. This Windows environment has no available `adb`/`java` command or Apple build toolchain. No physical phone session is connected.

Still required for the definition of done: native builds, real camera permission grant/denial/settings recovery, physical EAN-13 detection, duplicate suppression under real callbacks, cover display, Scan Another, app background/foreground behavior and Google success on device. Follow README's device checklist. Phase 1 implementation is ready for that validation; full device acceptance is pending. Phase 2 has not started.
