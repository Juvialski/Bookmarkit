# Bookmarkit

A small Android/iOS ISBN scanner: Expo SDK 57, React Native and TypeScript. Google Books and Open Library are called directly, with a small bundled SQLite catalog for offline fallback. No backend, accounts or persistent history.

## Current test target: emulators/simulators

For the current development phases, acceptance is emulator/simulator-based. Physical Android/iPhone testing is intentionally deferred and is not a blocker yet.

Install Node.js 22.13+ (Node 24 works), then:

```sh
npm ci
npm start
```

Android emulator is the primary executable acceptance target for now. On macOS, an iOS Simulator can validate startup, layout, manual ISBN lookup, provider behavior and non-hardware flows. Camera/barcode behavior that requires real hardware is deferred. Expo Go/physical-phone instructions can still be used later when hardware acceptance begins.

Grant camera permission, then scan the ISBN barcode on the back cover. Manual ISBN entry works without camera permission. Permanently denied permission offers **Open settings**; permission is refreshed on return. Camera startup errors offer retry and manual lookup.

### Optional Google Books key

Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY`, then reload the app. Lookup works without it. The key is only appended when nonblank. This is a **public client key embedded in the bundle**, not a secret. Restrict its Google API access/quota appropriately; never commit keys or use private credentials. See [Expo public environment configuration](https://docs.expo.dev/guides/environment-variables/) and [Google Books API usage](https://developers.google.com/books/docs/v1/using).

### Installable builds

`eas.json` provides an internal **preview** profile with Android APK output. A local standalone release APK was built and tested on the Pixel 9 Pro Android 17 emulator. It uses the generated Android debug signing key and is for local testing, not store release. Artifact: `C:\Users\Al\Documents\Codex\Bookmarkit-emulator\bookmarkit-local-release.apk`. EAS remains logged out and unlinked; no cloud preview was produced.

First run `npx eas-cli@latest login` with your existing Expo account, then `npx eas-cli@latest init` to link the intended project. After linkage, run:

```sh
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform ios --profile preview
```

Android: install the APK from the successful EAS build page. iPhone: internal distribution requires Apple signing and registered device UDIDs. TestFlight instead requires a store distribution build, Apple Developer/App Store Connect setup and submission; the internal preview profile is not a TestFlight profile. Local Android builds need Android SDK/JDK; local iOS builds need macOS/Xcode. See [EAS build setup](https://docs.expo.dev/build/setup/). JavaScript export is not an installable native build.

## Lookup behavior

- Rear camera, EAN-13 only, checksum-valid 978/979 ISBNs only. Manual entry allows spaces/hyphens. A synchronous gate rejects duplicate or different barcodes while lookup/result is active.
- Camera unmounts during lookup, errors, background state and results. Scan Another remounts it; returning from background refreshes permissions and clears mount failure/torch state. A minimal guide and torch toggle help scanning.
- Google requires an exact ISBN identifier. It gets at most two attempts: one retry after 500 ms for 429 or 5xx only, with a five-second timeout per attempt. Network, timeout and malformed responses are not retried.
- Open Library resolves the ISBN edition, linked work, work ratings and up to eight unique authors. Secondary request failures preserve the identified edition. Its individual requests time out after ten seconds.
- Merge order: exact Google ISBN volume title first, then Open Library ISBN edition; first nonempty authors and valid HTTPS cover in that same order. Ratings remain separate; Open Library ratings span editions. Partial failure never erases another provider's book.
- Series requires one explicit numbered statement in edition/work series metadata. Examples: `The Stormlight Archive #1`, `Series ; book 2`, `Series, Vol. 3`, `Series (Volume 4)`, `Series : no. 5`, `Series (#6)`. Conflicts and unnumbered metadata stay unknown. Titles/subjects never establish series or standalone status.
- Missing author, rating, cover and series have placeholders. Failed cover loading also falls back to a placeholder. Service, connection, timeout and rate-limit messages use plain language.
- In-memory cache: normalized ISBN, at most 20 books, five-minute expiry; partial successes expire after 30 seconds. Failed/not-found lookups are not cached. Closing the app clears it. This is not offline storage.

## Small offline catalog

Offline currently means ISBN metadata lookup for **1,106 Open Library works / 7,916 indexed ISBN-13s** in `assets/catalog-v1.db`. The file is **823,296 bytes** (804 KiB); gzip measured **191,226 bytes** (measurement only; the app bundles raw SQLite). Average storage is **104.00 bytes per ISBN row**. A local Python SQLite test measured about **0.10 ms** per warm indexed lookup over 10,000 queries; this excludes native initialization, UI and provider waiting.

Providers run normally first. If neither returns a usable book, including actual network failures/timeouts, the app queries the catalog with a bound ISBN parameter. Partial provider success wins. A local hit displays **Offline catalog** and identifies ratings as stored Open Library data, not live ratings. A local miss after provider failure explains that the ISBN is outside the catalog. No network-state detector is required. Existing provider deadlines mean fallback can take roughly 10–11 seconds on a silently stalled connection; actual network failures can return sooner.

The catalog is separate from future app/user data. It is copied from the bundled asset to a versioned SQLite database on first launch. There are no downloads, updates or user writes. Change both the asset filename and database name when shipping a new catalog version, to avoid retaining an older installed copy. Build date/version/source are stored in the `metadata` table; no per-book freshness is claimed.

### Regenerate

Python 3.10+ standard library only:

```sh
python scripts/catalog.py
python scripts/test_catalog.py
# Optional live source refresh (outside CI; takes a few minutes):
python scripts/catalog.py --refresh
```

The checked-in `catalog/source.json` snapshot makes regeneration network-independent. Refresh requests eleven 100-work pages of popular English-language Open Library search results, five unrated examples, and seven exact seed editions. It retains up to eight sorted valid ISBN-13 variants per work, converts checksum-valid ISBN-10s, collapses whitespace, deduplicates authors/ISBNs, and keeps the first record for an ISBN. Exact seed editions come first. `catalog/curated.json` contains two small sourced annotations: the publisher explicitly identifies The Way of Kings as Stormlight Archive book 1, and the author identifies Warbreaker as standalone. Missing series data remains unknown. Open Library ratings remain work-level and can be missing. No covers are bundled or requested for local results; the existing placeholder is intentional.

Search metadata is work-level: edition titles/languages and author contributions can differ across its ISBN variants. The seven exact seed editions are more precise; this practical proof does not claim comprehensive or edition-perfect offline coverage. Refresh changes the snapshot as public metadata changes. Building twice from the same snapshot, annotations and SQLite version produces the same database. No full dumps are ingested.

### Android offline acceptance

Build/install a standalone APK with the native SQLite module (`npx expo run:android --variant release --no-bundler`), then cold-launch it without Metro. Verify online manual lookup and Scan Another first. To force a real outage, disable emulator Wi-Fi/mobile data with `adb shell svc wifi disable` and `adb shell svc data disable`; verify there is no validated internet route. Force-stop/relaunch the app to clear the short-lived session cache before offline checks. Test these ISBNs:

| ISBN | Purpose |
| --- | --- |
| 9780140328721 | Fantastic Mr. Fox; stored rating, unknown series |
| 9780765326355 | The Way of Kings; stored rating, explicit book 1 |
| 9780547928227 | The Hobbit; known extra seed |
| 9780765320308 | Warbreaker; explicit standalone |
| 9780140430776 | American notes; unrated, multiple authors |
| 9791032300336 | Valid checksum fixture outside this catalog; clear miss |

Confirm title/authors, rating or Not rated, series status, missing-cover placeholder and Scan Another. Restore Wi-Fi/mobile data afterward. Physical devices remain deferred. iOS config/export is validated on Windows; iOS Simulator acceptance requires macOS.

## Future physical-device checklist (deferred)

This checklist is intentionally deferred and does not block current development. Current acceptance should use Android Emulator and, when available, iOS Simulator. Preserve this list for the later hardware-validation phase.

1. Fresh launch; allow camera permission.
2. Scan a physical 978 ISBN; keep it visible and verify only one lookup/result.
3. Verify title, author and cover; verify available ratings and series when provider metadata contains it.
4. Tap Scan Another; scan a second book, then the same book again.
5. Background and return during scanning and lookup; verify recovery and torch reset.
6. Toggle torch on supported hardware.
7. Deny camera permission; recover through Settings and return.
8. Use manual ISBN lookup with keyboard open on a small screen; ensure input and button remain reachable.
9. Test weak/no internet; reconnect and retry. Confirm partial provider failure still shows the identified book (Google rate limiting may provide this naturally).
10. Present malformed/non-book EAN; verify no lookup. Also try invalid manual input.
11. Check long titles/authors and missing/failed covers; scroll to Scan Another. Check Android Back during lookup/results and safe areas around system UI.

## Validation commands

```sh
npm ci
npm test
python scripts/test_catalog.py
npm run typecheck
npm run lint
npx expo install --check
npx expo-doctor
npx expo config --type introspect
npx expo export --platform android
npx expo export --platform ios
```

CI runs mocked tests, local catalog fixture/integrity/regeneration checks, TypeScript, lint and dependency compatibility checks. No live dataset downloads, emulator jobs or native builds run in CI. Exports and doctor are local release-readiness checks. Manual live smoke: `npx tsx scripts/provider-smoke.ts` (two ISBNs, not in CI). Current evidence and blockers: [VALIDATION.md](VALIDATION.md).

Existing Expo/React Native toolchain npm audit findings remain; no forced SDK downgrade was applied. Provider metadata is incomplete and ratings change. ISBN `9791032300336` is a synthetic checksum fixture, not a verified catalog record. Current readiness fixes enable iPhone autofocus, keyboard-aware manual entry, camera-only permissions and HTTPS-only iOS transport. For now, continue emulator/simulator-based validation; physical Android/iPhone acceptance is deferred. See VALIDATION.md for current evidence.
