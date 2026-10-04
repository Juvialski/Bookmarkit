# Android phone test

1. [Download bookmarkit-android-test.apk](https://github.com/Juvialski/Bookmarkit/releases/download/android-test-2026-10-04/bookmarkit-android-test.apk), or unzip the **bookmarkit-android-test** artifact in a successful **Android test APK** Actions run.
2. Transfer/open the APK on your Android phone.
3. Allow installation from that browser/file manager if Android asks.
4. Install **Bookmarkit** and open it.
5. Tap **Allow camera** and approve camera permission.
6. Scan a real ISBN barcode (manual ISBN entry also works).
7. Tap **View on Goodreads** and check the ISBN search.
8. Turn off Wi-Fi and mobile data, then close and reopen Bookmarkit.
9. Look up an offline-supported book, such as `9780765326355` (The Way of Kings: SERIES, book 1) or `9780765320308` (Warbreaker: STANDALONE). Network timeouts can take about 20 seconds.
10. Turn internet back on, close/reopen Bookmarkit and retry.

Private test build; Android 7 or newer. If Android reports a signing conflict with an older test build, uninstall that older Bookmarkit first. Final physical-phone acceptance is pending your test.
