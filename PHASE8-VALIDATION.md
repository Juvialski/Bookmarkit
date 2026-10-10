# Phase 8: front-cover recognition

Baseline: refreshed live main `6043835f55c72a09ecec30139ed7c1941b1cd92a`, merged PR #7. Reused unfinished local scanner work and existing APK pipeline. No open PRs at start.

Unified still-image camera/gallery OCR, automatic ISBN, editable title/author search, deterministic bounded parser/ranking, work-level Open Library search/ratings, indexed offline catalog v3, no-ISBN Goodreads, cancellation/generation guards and Android versionCode 2. Existing exact-ISBN Hardcover remains unchanged.

## Native package evaluation

Inspected published `expo-ocr-kit` 0.1.4 Kotlin, Swift, podspec and Gradle sources. Android uses `com.google.mlkit:text-recognition:16.0.1` (bundled Latin), local URI decoding, EXIF rotation, 2000-pixel downsampling and recognizer cleanup. iOS uses local system Vision; podspec depends on ExpoModulesCore. JS exposes text and block boxes, no line confidence. No Firebase or cloud OCR.

Compared `expo-mlkit-ocr` 0.2.7: Android source also uses bundled text-recognition 16.0.1. The selected package already supplies required geometry, EXIF handling and bounded decoding with a smaller API. Neither README claims nor wildcard peer dependencies prove SDK 57 compatibility. Selection depends on actual release build/native tests below. Small maintainer footprint remains a limitation; version is pinned.

Sources: [Expo 57 camera](https://docs.expo.dev/versions/v57.0.0/sdk/camera/), [image picker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), [OCR kit source](https://github.com/ManojKanth/expo-ocr-kit), [alternative source](https://github.com/rbayuokt/expo-mlkit-ocr), [ML Kit bundled model](https://developers.google.com/ml-kit/vision/text-recognition/v2/android), [Open Library Search API](https://openlibrary.org/dev/docs/api/search).

## Validation status

- Mobile: 73 tests passed, including real SQLite indexed offline/fuzzy/ISBN queries, parser fixtures, conflicting work IDs, ambiguity, ISBN-10, Goodreads title fallback, cancellation and cache expiry.
- Backend: 20 regressions passed; syntax passed. No new Hardcover endpoint.
- Python catalog: 4 passed; integrity, deterministic regeneration and index plans.
- TypeScript/lint passed; Expo dependency check and Doctor 21/21 after SDK 57 patch alignment.
- iOS export/configuration verified on Windows; Xcode compilation and native Vision execution NOT performed.
- Android universal release APK successfully built on Linux. Native ML Kit ran on Android 15/API 35 x86_64 emulator through the real system gallery picker, with the standalone release JS bundle and no Metro.
- Live Open Library title/author probes returned The Way of Kings (/works/OL15358691W, 4.5120482/166) and Warbreaker (/works/OL5738149W, 4.304348/23). Provider unit tests remain mocked; SQLite tests use the real bundled database.
- Physical-camera acceptance: pending user's phone. Gallery/emulator recognition does not prove hardware focus, lighting or torch.

## Distribution

[Validated implementation APK](https://github.com/Juvialski/Bookmarkit/actions/runs/37766580274/artifacts/11546033643), built from b35363b. SHA256 `05d2e54d79ae46d2ee0f82ad56e19c0560109e3ab3ad0c9e841cb2a62e4b110e`.

Native observations on that APK: first-launch airplane mode (no active default network), ungranted camera permission, real Warbreaker cover -> Warbreaker / Brandon Sanderson / Standalone / stored Open Library 4.3 (23), without ISBN. Synthetic multiline THE WAY / OF KINGS -> The Way of Kings / Brandon Sanderson / Stormlight Archive book 1 / stored 4.5 (166). Same-process Scan Another worked. Offline manual title/author and ISBN-10 0140328726 succeeded. Reconnected real-cover OCR reached the result with online rating. Goodreads title/author intent opened externally. APK contains bundled model files, catalog-v3 and release JS; no broad photo-library or microphone permissions.

[Expanded passing native acceptance](https://github.com/Juvialski/Bookmarkit/actions/runs/37766575462) used the previous 15ee96a runtime APK and also verified picker cancellation. The latest APK passed all preceding checks but the final harness Back event raced picker opening; the harness now waits for the Cancel control before cancelling. Final exact-head native CI remains required before merge.

Version 1 -> version 2 `adb install -r` succeeded against the published PR #7 APK in a disposable emulator. Both tested APKs share Android Debug certificate SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Other locally generated test signatures may still require uninstall/reinstall; no general seamless-upgrade claim.

Local Android 17 preview emulators had system/launcher ANRs and storage constraints, so authoritative native acceptance uses the stable Linux Android 15 emulator. A short-path Windows build compiled the OCR Kotlin module, but was stopped to release RAM; no local release build success is claimed. iOS export/configuration and TypeScript passed, not native compilation. Physical focus, lighting, angled/glossy covers and real flashlight remain pending the user's phone.

Only Latin OCR is bundled. Provider metadata can be incomplete. Offline scope is the 1,109-work catalog; unsupported books need internet. No image uploads, Supabase, scraper, LLM or desktop Chrome use.
