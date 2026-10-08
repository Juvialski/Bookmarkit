# Phase 8: front-cover recognition

Baseline: refreshed live main `6043835f55c72a09ecec30139ed7c1941b1cd92a`, merged PR #7. Reused unfinished local scanner work and existing APK pipeline. No open PRs at start.

Unified still-image camera/gallery OCR, automatic ISBN, editable title/author search, deterministic bounded parser/ranking, work-level Open Library search/ratings, indexed offline catalog v3, no-ISBN Goodreads, cancellation/generation guards and Android versionCode 2. Existing exact-ISBN Hardcover remains unchanged.

## Native package evaluation

Inspected published `expo-ocr-kit` 0.1.4 Kotlin, Swift, podspec and Gradle sources. Android uses `com.google.mlkit:text-recognition:16.0.1` (bundled Latin), local URI decoding, EXIF rotation, 2000-pixel downsampling and recognizer cleanup. iOS uses local system Vision; podspec depends on ExpoModulesCore. JS exposes text and block boxes, no line confidence. No Firebase or cloud OCR.

Compared `expo-mlkit-ocr` 0.2.7: Android source also uses bundled text-recognition 16.0.1. The selected package already supplies required geometry, EXIF handling and bounded decoding with a smaller API. Neither README claims nor wildcard peer dependencies prove SDK 57 compatibility. Selection depends on actual release build/native tests below. Small maintainer footprint remains a limitation; version is pinned.

Sources: [Expo 57 camera](https://docs.expo.dev/versions/v57.0.0/sdk/camera/), [image picker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [OCR kit source](https://github.com/ManojKanth/expo-ocr-kit), [alternative source](https://github.com/rbayuokt/expo-mlkit-ocr), [ML Kit bundled model](https://developers.google.com/ml-kit/vision/text-recognition/v2/android), [Open Library Search API](https://openlibrary.org/dev/docs/api/search).

## Validation status

- Mobile: 67 tests passed, including real SQLite indexed offline/fuzzy/ISBN queries, parser fixtures, conflicting work IDs, ambiguity, ISBN-10, Goodreads title fallback, cancellation and cache expiry.
- Backend: 20 regressions passed; syntax passed. No new Hardcover endpoint.
- Python catalog: 4 passed; integrity, deterministic regeneration and index plans.
- TypeScript/lint passed; Expo dependency check and Doctor 21/21 after SDK 57 patch alignment.
- iOS export/configuration verified on Windows; Xcode compilation and native Vision execution NOT performed.
- Android release build/native emulator OCR: in progress, no success claimed yet.
- Live provider observations: pending; provider unit tests are mocked.
- Physical-camera acceptance: pending user's phone. Gallery/emulator recognition does not prove hardware focus, lighting or torch.

## Distribution

Final exact-head Actions artifact and tested APK hash will be recorded after native validation. Existing test signing is retained. Different signatures require uninstall/reinstall; update compatibility must be checked before claiming it.
