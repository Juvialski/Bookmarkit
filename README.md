# Bookmarkit

A small Android/iOS ISBN scanner using React Native, Expo SDK 57, TypeScript and expo-camera. No backend, account, persistence, or API keys. Only Google Books and Open Library are called directly.

## Setup and run

Install Node.js 22.13+ (Node 24 also works), then:

```sh
npm ci
npm start
```

Install an Expo Go version compatible with SDK 57 on a physical Android or iOS phone. Connect to the same network and open the terminal QR code (Expo Go on Android; Camera on iOS). If LAN access is blocked, try `npx expo start --tunnel`. Expo Go itself may require an Expo account depending on its version; Bookmarkit has no accounts.

- Android: `npm run android` opens Expo Go on a connected device/emulator. A local native build uses `npx expo run:android` and needs Android Studio, Android SDK, a supported JDK and a device/emulator.
- iOS: use the QR code on a physical iPhone from Windows. `npm run ios` opens a simulator on macOS. A local native build uses `npx expo run:ios` on macOS with Xcode and CocoaPods; physical native installs need Apple signing.
- Both platforms share the same source. Physical phones are required to verify camera scanning; a simulator is useful for manual input.

Tap **Allow camera** when first opening the scanner. The Expo camera config plugin supplies Android CAMERA permission and the iOS usage description. Audio recording permission is disabled on Android. If camera access was permanently denied, **Open settings** lets you enable it; permissions refresh when returning. Manual ISBN lookup works without camera access.

## Behavior

Scan rear-camera EAN-13 barcodes starting with 978 or 979 and with a valid checksum. Manual entry accepts spaces/hyphens. A synchronous lock suppresses repeated callbacks, including different barcodes, until Scan Another or retry. The camera unmounts during lookup and on the result screen. Lookup errors pause callbacks until Resume scanner or manual lookup.

Provider adapters normalize data before the UI sees it. Google results must contain the scanned ISBN. Open Library resolves the ISBN edition, then its linked work, author records and work-level ratings. Both providers run independently; one successful identification is enough. Requests time out after 10 seconds each. No automatic retry or combined score.

Unavailable provider ratings are distinguished from an identified book with no rating. Open Library scores cover the work across editions; Google scores are for the matched volume. Author/cover/rating gaps are handled with placeholders. Covers that fail to load show a placeholder.

Series is accepted only from a single explicit Open Library edition statement like `Example Series ; book 2` (also volume/vol). Other forms remain unknown. The app never infers a series from the title or claims standalone based on missing information. This intentionally misses some true series memberships.

## Checks

```sh
npm test
npm run typecheck
npx expo install --check
npx expo-doctor
npx expo export --platform all
```

Tests use fixtures and mocked fetch responses, with no live API dependency. Source: `App.tsx`, `src/screens`, `src/services/providers`, `src/services/bookLookup.ts`, `src/models/book.ts`, `src/utils/isbn.ts`. Test fixtures live in `tests/fixtures.ts`.

## Known limitations and device acceptance

Public APIs may be unavailable, rate-limited or incomplete. No offline lookup. Author requests are capped at eight per edition. Series normalization is deliberately conservative. Book ratings are often absent. The app does not store scan history.

Platform bundle export and TypeScript checks do **not** establish a successful native build or physical camera behavior. Before declaring Phase 1 complete, test both physical Android and iPhone devices: grant/deny permission, re-enable in Settings, scan an ISBN repeatedly, scan another ISBN after the result, use Scan Another, test airplane mode and manual input, verify long titles and missing covers/ratings. Native Android and iOS binaries must also be built in their toolchains.

Example ISBNs used in automated validation: `9780140328721` (Fantastic Mr. Fox fixture), `9780765326355` (The Way of Kings checksum), `9791032300336` (synthetic checksum-valid 979 test; not a verified catalog record). Live provider smoke results and build evidence are recorded in `VALIDATION.md`.

Dependencies initially reported npm audit advisories in the Expo/React Native toolchain. Do not use `npm audit fix --force` to downgrade the Expo SDK; assess compatible upstream fixes before release.

The next smallest step is completing the physical-device acceptance checklist and native builds for this phase. Phase 2 has not been started.

References: [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), [Google Books ISBN search](https://developers.google.com/books/docs/v1/using), [Open Library JSON API](https://openlibrary.org/dev/docs/json_api).

