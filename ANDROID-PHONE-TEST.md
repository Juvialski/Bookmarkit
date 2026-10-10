# Android front-cover test

Download `bookmarkit-android-test.apk` from the current [Phase 8 validation record](PHASE8-VALIDATION.md) or the latest successful Android test APK Actions artifact. The old October 4 release is the ISBN-only baseline.

1. Install Bookmarkit and allow camera permission.
2. Point at a FRONT COVER with no barcode visible; tap **Scan Book**.
3. Verify title, author, rating/provider and supported series classification. Select the correct card if ambiguous.
4. Tap **View on Goodreads** and check title/author search when no ISBN was identified.
5. Tap **Scan Another** and immediately scan a second book.
6. Try **Choose Photo**, screenshots, picker cancellation and **Search Manually**.
7. In airplane mode, close/reopen and scan a locally supported cover (Warbreaker or The Way of Kings). OCR and stored ratings should work; unsupported books explain internet is needed.
8. Background during recognition, return and retry; deny camera permission and use gallery/manual search.

Android 7+. VersionCode 2. Update from the published version 1 APK passed in the emulator. If another test APK has an incompatible signing key, uninstall/reinstall. Physical camera focus, lighting, glare and torch acceptance remains your phone test. iOS native compilation was not verified.
