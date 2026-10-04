# Scanner hardening validation — 2026-10-04

Base: `f633276` (merged MVP PR #1, current main at phase start). Exact final head and CI evidence are supplied in the PR handoff.

## Audit and changes

Audited App, both screens, scan gate/ISBN validation, provider adapters, result merge, config, tests, README and CI on live main. Retained working synchronous scan gate, rear-camera EAN-13 filter, loading/result unmount and permission Settings recovery. Found error-state camera stayed mounted, non-book detections produced distracting errors, permission actions could reject without recovery, Google failures were generic/unretried, malformed Google payloads looked like not-found, covers were not validated, author calls could duplicate and there was no cache. Series parsing on main already supported the four requested baseline examples, but accepted mismatched parentheses and could miss conflicts across edition/work metadata.

Fixed those findings; added bounded Google retry/public optional key, deterministic documented merge, conservative series punctuation/no. support, short-lived bounded cache, scan guide/torch and focused mocked tests. Preserved the existing simple two-screen conditional flow; no navigation-framework migration or future-phase features.

## Automated/local

- `npm ci`: passed. Final lockfile reproducibility is also checked by CI.
- `npm test`: 32 mocked/fixture tests pass, including valid 978/979, bad checksum, duplicate/different ISBN gate and reset, exact ISBN, missing rating/cover, 429/5xx retry bounds, optional key, malformed/empty payloads, timeout, Open Library 404/secondary failures/request deduplication, merge/error precedence, series ambiguity and cache hit/expiry/eviction/error behavior.
- `npm run typecheck`: passed.
- `npx expo install --check`: compatible SDK 57 dependencies.
- `npx expo-doctor`: 21/21 checks passed.
- `npx expo config --type introspect`: passed; iOS camera usage description and Android CAMERA permission present; Android RECORD_AUDIO absent. Camera plugin supplies an unused iOS microphone description; scanner does not request microphone access. Android light-interface config emits the pre-existing expo-system-ui advisory; not a camera/export failure.
- `npx expo export --platform android`: passed (603 modules).
- `npx expo export --platform ios`: passed (605 modules).
- `npm run lint`: passed without warnings. Final revision review and exact-head CI results are recorded in the PR handoff.
- npm reports 23 existing toolchain audit findings (7 moderate, 16 high); no forced SDK changes.

These checks validate code and JS bundles, not native binaries or actual camera behavior. No phone, UI automation or hardware acceptance was performed. Scanner lifecycle/permission changes still require the README checklist on both platforms.

## Live provider smoke (Node on this computer)

After mocked tests, two ISBNs were checked sequentially using the actual adapters, without a key. Google performs only its single bounded retry. No live response is used as a CI assertion.

| ISBN | Google Books | Open Library |
| --- | --- | --- |
| 9780140328721 | 429 after retry; typed rate-limit failure | Fantastic Mr. Fox; Roald Dahl; cover URL present; work rating 3.9504 / 121; series unknown |
| 9780765326355 | 429 after retry; typed rate-limit failure | The Way of Kings; Brandon Sanderson; cover URL present; work rating 4.5120 / 166; series unknown |

Ratings are a dated observation. Cover URLs were returned but image display was not physically verified. Google live success remains blocked by rate limiting; exact-match success and fallback behavior pass mocks. Explicit series fixtures pass, but these live editions supply no accepted series statement.

## Native/cloud build preflight

- `npx eas-cli@latest whoami`: exit 1, **Not logged in**. No EXPO_TOKEN/EAS authentication environment variable was available. The starting repository had neither eas.json nor extra.eas.projectId. Added only a preview profile for future Android APK/internal iOS builds; did not register a project or initiate credential prompts.
- Android local: `adb` and `java` unavailable on PATH; no connected phone session. Cannot build/install locally here.
- iOS local: Windows host, no macOS/Xcode/Apple signing environment. Cannot build/install locally here.
- No non-interactive authenticated build environment is usable, so cloud native builds could not be submitted. No APK, IPA, TestFlight build or signed installable artifact was produced. Hermes exports are only JS bundles.

## Handoff

Open one PR for review; do not merge. Next: check out the PR head, `npm ci`, `npm start`, run README's checklist in SDK 57-compatible Expo Go on physical Android and iPhone. Then authenticate/configure EAS and Apple signing as appropriate to produce native preview binaries. Public provider availability, physical scanning/permission/torch behavior, and signed native builds remain external acceptance blockers. No offline-data or product-expansion phase was started.
