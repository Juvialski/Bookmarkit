# Bookmarkit

Point your camera at a front cover and tap **Scan Book**. Bookmarkit reads one image locally and identifies the book through the central Supabase catalog, Open Library, Google Books or an optional Hardcover proxy. No visible ISBN is required. The optional expanded offline catalog contains 25,265 works and is downloaded separately. Valid visible barcodes are automatic. **Choose Photo** and **Search** use the same resolver and work without camera permission.

Expo SDK 57 / React Native 0.86 / Expo Router. Native `expo-ocr-kit` 0.1.4 uses bundled ML Kit Latin recognition on Android and Apple Vision on iOS. Images stay on the device; no Firebase, LLM or image upload. Expo Go cannot run this module; use the standalone APK or a development build.

## Development

Node 22.13+ and npm:

```sh
npm ci
npm start
npm run typecheck
npm run lint
npm test
npm --prefix server test
npm --prefix server run check
python scripts/test_catalog.py
npx expo install --check
npx expo-doctor
```

Routes: `src/app/`. Parser/ranking: `src/recognition/`. Providers: `src/services/`. Camera and gallery call `readCover` then `identifyBook`. Native OCR exposes block positions, no confidence or line boxes. Ambiguous results show up to four candidates; incomplete reads provide editable search, retry and cancel. Request generations prevent stale results; network calls have deadlines; successful normalized searches use a bounded session cache. Backgrounding during recognition/search cancels the operation; system photo selection remains supported.

## Identification and ratings

- ISBN-13 and valid ISBN-10 (converted to ISBN-13) retain exact-edition lookup, including the existing optional Hardcover proxy.
- Title/author searches coordinate central Supabase, Open Library and Google Books concurrently. Exact ISBN lookups also support the optional Hardcover proxy. Confident bundled/expanded matches return immediately; selection generations protect later enrichment.
- Matching uses title/subtitle similarity, compatible authors, exact ISBN and work identity. Popularity does not establish identity. Weak/competing matches require selection. Different work IDs never share ratings.
- Title results identify a work, not an exact edition; arbitrary ISBNs are not attached. Work ratings stay labeled Open Library. Hardcover ratings remain available for exact ISBN. Scores are never averaged. Missing series evidence means Series unknown.
- Goodreads opens an external search by exact ISBN when identified, otherwise title and author. No scraping or Goodreads rating ingestion.

Optional Hardcover: set public HTTPS `EXPO_PUBLIC_BOOK_API_BASE_URL` to the existing proxy. `HARDCOVER_API_TOKEN` belongs only on the server; see [server setup](server/README.md). No proxy is needed for cover recognition, Open Library ratings or offline operation.

## Offline catalog

`assets/catalog-v3.db` contains 1,109 works / 7,919 ISBNs. Indexed normalized titles, token postings and title trigrams shortlist at most 80 rows per query before ranking. Search runs on submission, never each keystroke. The bundled Latin OCR model requires no first-launch download. Local hits show stored Open Library ratings and supported classification. Absent books explain that additional details need internet, separately from OCR failure. Covers are not bundled.

```sh
python scripts/catalog.py
python scripts/test_catalog.py
```

Regeneration uses the checked-in snapshot deterministically. `--refresh` explicitly refreshes the small public snapshot. SQLite asset/database version changes together so installed apps receive new indexes. Work matching does not claim exact edition identity.

## Standalone Android test APK

See [phone instructions](ANDROID-PHONE-TEST.md) and [Phase 8 evidence](PHASE8-VALIDATION.md). **Android test APK** builds for relevant source, assets, tests, dependencies and native configuration changes, on PRs and main pushes. Docs-only changes do not build. Manual dispatch remains supported. Artifact **bookmarkit-android-test** includes APK and SHA256, retained 30 days.

```sh
npm run build:android-test
python scripts/android-apk-smoke.py --adb /path/to/adb --apk dist/bookmarkit-android-test.apk
```

Local build requires JDK 21 and Android SDK (`JAVA_HOME` / `ANDROID_HOME`). On Windows use a genuinely short source directory, such as `C:\b8`, to avoid generated C++ path limits. Expo generates native folders. The release APK bundles JS, OCR/model and SQLite and launches without Metro. Universal phone/emulator architectures remain supported. Debug signing is for testing; older independently signed APKs may require uninstall/reinstall.

Physical front-cover focus/lighting/torch remains pending the user's phone testing. Windows can verify iOS configuration, TypeScript and export but cannot validate Xcode compilation or native Vision execution.

## Next phase (documentation only)

Supabase central normalized catalog; title/author/ISBN indexes; provider enrichment; monthly bulk refresh with provenance/deduplication; optional downloadable SQLite packs and download/update management. None is implemented in Phase 8.

## Bookmarkit V2

See [catalog operations](docs/CATALOG.md), [permanently free Gemini configuration](docs/FREE-GEMINI.md), and [V2 validation](docs/V2-VALIDATION.md). The interface has a camera scanner, compact book results and Offline Books. No accounts or reading lists are required.
