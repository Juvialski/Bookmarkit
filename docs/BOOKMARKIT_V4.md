# Bookmarkit V4 acceptance

Automatic selected-book caching uses a separate `personal-books-v1.db`, WAL and an indexed edition key. Personal metadata is checked before the expanded and bundled catalogs. Selected candidates only are persisted; progressive updates use selection/cancellation guards. Provider ratings keep their own counts and scopes. No OCR image, raw OCR text, search log, cover download, Gemini output or new shared-write endpoint is stored.

Edition ISBNs remain separate from works. Title/author-only identities require authors and do not become edition claims. A contradictory same-key title/author is rejected. Unavailable ratings do not overwrite prior usable ratings. Corrupt rows are skipped; an unreadable SQLite file is retained and a separate recovery cache used. Recovery cannot reconstruct damaged bytes. Future schema versions fail closed rather than downgrade.

Goodreads links use existing verified ratings first, then a single structured Open Library edition identifier with an explicit matching ISBN. Work-only searches keep title/author search unless existing verified Goodreads evidence supplies a link. Conflicting IDs and other-host links are rejected. Link discovery never manufactures a Goodreads score.

Existing protected Hardcover cache ingestion remains authoritative. Broader shared catalog ingestion is deferred: local cache writes require no backend write permission. No catalog rebuild or Goodreads collector reset is required.

## Gemini / grounding

Read-only production checks verified billing disabled, project/key ownership and `gemini-3.5-flash-lite` availability. After deployment, exactly one live text request returned `Warbreaker by Brandon Sanderson`, using 36 tokens. This is useful normalized text, separate from historical 35-token usage. No grounding request was made. Gemini remains optional backend text normalization, not a mandatory scan step.

Google Search grounding remains disabled: the authorized unbilled project previously rejected it. Current [pricing](https://ai.google.dev/gemini-api/docs/pricing) lists Search grounding as unavailable in the Gemini 3.5 Flash-Lite free tier. Free allowances in the paid tier do not establish unbilled project eligibility. No billing or model/project/key rotation was performed.

Both worker memory and durable cooldown are operation scoped. Provider Retry-After / RetryInfo is honored. A 429 without reset evidence conservatively blocks until the next Pacific daily reset; it does not trigger a retry or failover. Unsupported/configuration failures disable the affected operation indefinitely. A backend-only configuration fingerprint allows corrected, reverified configuration to clear only its unsupported-operation flag. Timed provider backoff and project/model daily usage remain intact across configuration changes. Reservation limits and 15-second spacing remain enforced. Usage-recording failure cannot discard valid provider text after an attempt has already been reserved.

## Series

Warbreaker displays `Sequel planned` using exact title/author reviewed evidence from [State of the Sanderson 2025](https://www.brandonsanderson.com/blogs/blog/state-of-the-sanderson-2025). It does not claim a published multi-book series or standalone status. Other titles retain existing conservative classification and conflicting-provider handling.

## Evidence

- Local: 107 mobile/service tests and 48 backend tests passed; lint/typecheck required at final head.
- Hosted: additive operation-circuit migration applied; service-role rollback contract proved blocked grounding and independently eligible text. RLS enabled; anonymous/authenticated writes and anonymous reservation denied. `book-search` deployed.
- Android: CI builds version 1.3.0 / versionCode 5 using the established APK signing pipeline. Native acceptance tests exercise actual SQLite, new live books, restart, APK replacement, monthly catalog download/replacement, Goodreads intent and provider attribution. Results and timing are recorded in the workflow artifacts; pending until CI completes.
- Latency reporting measures complete UI automation, including typing and accessibility polling, and is not a pure provider or lookup benchmark.
