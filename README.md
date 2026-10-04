# Bookmarkit

A small Android/iOS ISBN scanner: Expo SDK 57, React Native and TypeScript. Google Books and Open Library are called directly. No backend, accounts, persistent history or offline catalog.

## Test on a phone

Install Node.js 22.13+ (Node 24 works), then:

```sh
npm ci
npm start
```

Use an SDK 57-compatible Expo Go app and the same network as this computer. Android: scan the terminal QR code inside Expo Go. iPhone: scan it with Camera and open Expo Go. If LAN access fails, try `npx expo start --tunnel`. A simulator can test manual entry; camera acceptance requires physical phones.

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

## Physical-device checklist (Android and iPhone separately)

Run on Android and iPhone separately; record device/OS, commit, pass/fail and observations. Hardware acceptance is still pending.

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
npm run typecheck
npm run lint
npx expo install --check
npx expo-doctor
npx expo config --type introspect
npx expo export --platform android
npx expo export --platform ios
```

CI runs mocked tests, TypeScript, lint and dependency compatibility checks. Exports and doctor are local release-readiness checks. Manual live smoke: `npx tsx scripts/provider-smoke.ts` (two ISBNs, not in CI). Current evidence and blockers: [VALIDATION.md](VALIDATION.md).

Existing Expo/React Native toolchain npm audit findings remain; no forced SDK downgrade was applied. Provider metadata is incomplete and ratings change. ISBN `9791032300336` is a synthetic checksum fixture, not a verified catalog record. Current readiness fixes enable iPhone autofocus, keyboard-aware manual entry, camera-only permissions and HTTPS-only iOS transport. Next: authenticate EAS to generate signed previews and run the checklist on real Android/iPhone. See VALIDATION.md for current evidence.
