# Android front-cover test

Download the `bookmarkit-android-test` artifact from the successful [Android test APK workflow](https://github.com/Juvialski/Bookmarkit/actions/workflows/android-test-apk.yml) for the result UI fix. Extract the ZIP, copy `bookmarkit-android-test.apk` to your phone and open it. Allow Android's install-from-this-source permission if prompted. The old October 4 release is the ISBN-only baseline.

1. Install Bookmarkit and allow camera permission.
2. Point at a FRONT COVER with no barcode visible; tap **Scan Book**.
3. Verify title, author, real online cover where available, numerical rating, five fractional golden stars, rating count/source and supported series classification. Select the correct card if ambiguous.
4. Tap **View on Goodreads** and check title/author search when no ISBN was identified.
5. Tap **Scan Another** and immediately scan a second book.
6. Try **Choose Photo**, screenshots, picker cancellation and **Search Manually**.
7. In airplane mode, close/reopen and scan a locally supported cover (Warbreaker or The Way of Kings). OCR and stored ratings should work; unsupported books explain internet is needed.
8. Background during recognition, return and retry; deny camera permission and use gallery/manual search.

Android 7+. Version 1.1.1 / versionCode 3. Prefer an update install to retain your offline catalog. If Android reports an incompatible signing key, an uninstall/reinstall removes downloaded catalog data; download it again afterward. Physical camera focus, lighting, glare and torch acceptance remains your phone test. iOS native compilation was not verified.
