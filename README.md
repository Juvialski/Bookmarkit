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

`eas.json` provides an internal **preview** profile with Android APK output. No binary has been produced here: this environment is not logged into Expo, the app has no registered EAS project ID, and local Android tools are unavailable.

After authenticating your existing Expo account and registering/configuring this project, run:

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

1. Launch app.
2. Grant camera permission.
3. Scan a physical ISBN.
4. Verify title, author and cover.
5. Repeatedly expose the same barcode; ensure one lookup/result.
6. Tap Scan Another.
7. Scan another book; also try the same book to check cache responsiveness.
8. Background/reopen during scanning and lookup; verify recovery and torch reset.
9. Deny permission, use manual entry, then re-enable in Settings.
10. Test poor/no internet and retry after reconnecting.
11. Verify missing ratings/cover do not break results.
12. Try a known series book; explicit series or “Series information unavailable” is acceptable when providers lack confident metadata.

Also check Android Back during lookup/result, torch on supported hardware, invalid manual input, and a non-book EAN barcode (must not trigger lookup). Record device/OS, app revision and observations. No physical camera acceptance has been claimed.

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

Existing Expo/React Native toolchain npm audit findings remain; no forced SDK downgrade was applied. Provider metadata is incomplete and ratings change. ISBN `9791032300336` is a synthetic checksum fixture, not a verified catalog record. Next step: run the checklist on real Android/iPhone using Expo Go, then configure signed native preview builds.
