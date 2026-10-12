# Bookmarkit V5 — smart catalog expansion

V5 continues from merged PR #17 (`ff99812`). It preserves the separate automatic personal cache, verified Goodreads priority, planned-sequel evidence for Warbreaker, Gemini text configuration, disabled grounding and existing provider budgets.

## Authoritative baseline

The complete paginated public Supabase inventory on 12 October 2026 contains 25,266 works, 25,266 editions and 26,465 ISBNs. 9,957 works have authors, 1,703 have Open Library ratings and 323 have series classification. There are 117 normalized-title collision groups; these are not automatically merged. All catalog cover fields are empty, so no broken non-null catalog covers were found or fetched. Covers remain an online display feature and are excluded from redistribution.

The published package contains 25,265 works, 26,464 ISBNs, 4,160 works with authors and 1,703 works with Open Library ratings; its size is 31,838,208 bytes. The protected Hardcover runtime cache contains 30 observations covering 24 distinct rated provider works. These observations were not equivalent to 24 public offline catalog ratings.

The fixed 27-book cohort includes fantasy, YA, romance, classics, contemporary fiction, recent releases, obscure fiction and three title/author-only cases. Its reviewed public inputs and before/after reports are under `docs/evidence/v5`. ISBN and title/author hits are separate; a missing ISBN is excluded from the ISBN denominator. Title/author acceptance requires a unique normalized title and agreeing author. Unknown series remains unknown.

## Shared ingestion and security

An ordinary lookup continues to use the existing bounded Hardcover Edge Function. It accepts only an ISBN or bounded title/author identifier, independently queries the official structured API and writes the existing verified cache under its durable budget. There is no new public write endpoint, client JSON upload or service credential in mobile code.

The additive server trigger accepts a cache key into `accept_hardcover_catalog`, locks canonical provider/ISBN identities and independently checks existing assignments. Known Open Library mappings are retained; a new Hardcover canonical identity uses `hardcover:<id>` and a verified edition uses `hardcover-edition:<id>`. A title-only observation cannot create an edition or ISBN. Conflicts are declined. Metadata, provider mapping, edition relationship and paired work rating commit atomically. Older observations cannot replace newer ratings. Goodreads records are untouched. Public readers have SELECT; ingestion functions, queue and budget remain service-only with RLS and explicit grants.

Series uses its independently structured relationship, regardless of which rating wins. Missing relationships never imply standalone. Contradictory provider relationships remain unknown, curated standalone evidence is preserved, and the sourced Warbreaker planned-sequel override remains authoritative.

## Bulk refresh and publication

`scripts/smart_catalog.py` starts from the complete hosted inventory rather than discarding it for another first-encountered sample. Exact reviewed bundled editions are safe seeds. The official ratings dump is aggregated in disk-backed SQLite and its counts rank up to 2,000 target works; popularity is a selection signal, never identity proof. A bounded edition stream accepts only explicit single-work relationships and checksum-valid unclaimed ISBNs. Previously accepted selections and stream offsets persist.

Author downloads retain a pinned dump identity, byte checkpoint and disk-backed resolution checkpoint. Mirror hostname changes do not invalidate identical bytes. Complete JSON records from a partial gzip can resolve names; its incomplete tail is excluded, and the run does not claim a completed author dump. Partial resolution cannot replace an existing author list with fewer names. Changes in the requested reference set invalidate only the resolution pass offset, retaining known names. Memory is bounded by this catalog and its referenced authors rather than the complete upstream author database.

The builder keeps exact per-ISBN edition mappings and supports title/author-only work rows without fabricated ISBNs. Optional provider JSON excludes covers, match queries, reviews and private fields. Existing records, ISBN checksums, edition links, required indexes, SQLite integrity, counts and package hash must pass before selection/publication. Stable content skips a redundant rebuild. Immutable Storage is verified before advertising a manifest; the previous snapshot remains usable. Hardcover provider outages cannot require retries or hold publication behind provider availability.

## Personal SQLite

The existing `personal-books-v1.db` file migrates transactionally to schema version 2. Separate normalized-title, token and trigram indexes backfill in 200-row batches. Saves update metadata and indexes in one transaction. Exact title searches fetch only matching JSON; fuzzy candidates are bounded to 80 with a truncation sentinel, and a truncated set cannot produce certainty. Failure rolls back the version and indexes while retaining all personal records. Future versions fail closed. Personal storage remains separate from catalog replacement.

The benchmark runs the actual immutable v1.3.0 module against V5 on synthetic public-safe records at 100, 1,000, 5,000 and 10,000 books. Desktop SQLite timings are distinct from Android lookup-button/UI measurements.

## Source permissions

The current [official Hardcover API source](https://github.com/hardcoverapp/hardcover-docs/blob/6ee717ec9a2c810d859a2a0b09a0a95354ac2a27/src/content/docs/api/Getting-Started.mdx) permits attributed aggregate data and says Hardcover asserts no proprietary rights over the data. Applying that aggregate-data permission to runtime caching, personal offline caching, shared summaries and downloadable aggregate snapshots is the implementation's interpretation of this general permission; the docs do not distinguish those storage forms or impose a snapshot-specific restriction. Each summary retains Hardcover attribution, work scope, average/count, identity and retrieval date. Individual ratings, reviews, histories and images are excluded. No broader permission is inferred for them.

[Open Library licensing](https://openlibrary.org/developers/licensing) and [official dumps](https://openlibrary.org/developers/dumps) support the existing public metadata ingestion. Existing Goodreads verified aggregate/link handling is retained, with additional edition identifiers accepted only from explicit edition/ISBN relationships. No Goodreads scraping or Gemini generation is used to build the database.

## Acceptance

Local tests cover metadata preservation, author resume, popular selection, ISBN/edition mapping, work-only snapshots, migration rollback, 10,000 personal records and conservative identity/classification. Hosted rolled-back contracts exercise actual Postgres atomic acceptance, source/count pairing, idempotency, stale preservation, conflict refusal and anonymous/authenticated denial. Supabase deployment and advisor evidence are recorded separately from GitHub exact-head CI and Android upgrade evidence.

## Measured result — 12 October 2026

| Measure | Before | After |
| --- | ---: | ---: |
| Hosted distinct source work IDs | 25,266 | 26,000 |
| Hosted editions | 25,266 | 25,996 |
| Valid ISBNs | 26,465 | 27,216 |
| Hosted works with at least one verified author name | 9,957 | 16,988 |
| Offline works with author names | 4,160 | 16,988 |
| Open Library-rated works | 1,703 | 2,413 |
| Hardcover-rated works in shared/public snapshot | 0 | 26 |
| Goodreads-rated works in public snapshot | 0 | 1 |
| Structured edition Goodreads links in snapshot | 0 | 79 |
| Searchable shared works without ISBN | 0 | 5 |
| Public snapshot bytes | 31,838,208 | 35,176,448 |
| Fixed cohort: shared ISBN match | 1/24 | 18/24 |
| Fixed cohort: shared title/author match | 1/27 | 20/27 |
| Fixed cohort: expanded offline ISBN match | 0/24 | 18/24 |
| Fixed cohort: expanded offline title/author match | 0/27 | 20/27 |

The coverage comparison measures the expanded/public catalog, not the pre-existing bundled catalog or the entire combined app corpus. The immediate bundled fallback is retained. Work counts are distinct provider/source work identifiers, not editions or a claim that all cross-provider duplicates are resolved. Normalized-title collisions increased from 117 to 134 groups. The strict cohort declines ambiguous Dune and Outlander cross-provider IDs, plus unmatched Harry Potter UK identity, Babel, The Name of the Wind, Intermezzo and Emma. It does not count a chooser as confident identification. Author completeness here means presence of at least one resolved author name, not proof that every contributor has been resolved.

The protected Hardcover cache improved from 24 to 26 distinct rated works. Twenty-four previously verified works became reusable in the public package; two new title-only API observations verified Onyx Storm (3.953375086986778 / 1,437 ratings) and The Mysterious Mr. Quin (3.4767441860465116 / 43 ratings). Intermezzo returned no exact verified match. The fixed live audit completed 28 responses, with 25 agreeing identities, then stopped at Babel's existing per-key 429 lease. The remaining network cohort was not silently filled from projections. No lease, cooldown or daily allowance was reset.

Verified cross-provider work links require an independently retrieved Open Library edition listing the exact protected Hardcover ISBN and parent work, plus agreeing title/author. Title equality only discovers candidates. The service-only link contract passed with rollback; the bounded live pass made one request and accepted zero links. Current ambiguous source IDs therefore remain separate. Future monthly runs may accept a link only when this independent proof is available.

Actual desktop Node SQLite comparison at 10,000 synthetic public-safe personal records: **243.48 ms median before, 0.031 ms after**, decoding 10,000 JSON rows before versus one after. The indexed migration and interruption/restart tests passed at 100, 1,000, 5,000 and 10,000 books. Local warm package ISBN lookup measured 0.138 ms median / 0.216 ms p95. GitHub Linux SQLite measured 0.0096 ms median in its publication artifact; this is a different machine and is not claimed as an Android benchmark.

The Android emulator's actual lookup-button-to-title measurements were **4.566 s online and 5.433 s offline**, including accessibility polling and excluding typing. There is no comparable pre-phase online latency baseline, so an online speed improvement is not claimed. Native OCR, source attribution, Goodreads priority, restart, APK replacement, catalog replacement, corruption recovery and **v1.3.0/versionCode 5 → v1.4.0/versionCode 6** personal/database upgrade passed. These are emulator results, not physical-phone acceptance.

The [monthly workflow](https://github.com/Juvialski/Bookmarkit/actions/runs/38205403779) completed with the configured existing repository secret. The final trusted local publication used immutable SHA-256 `9903ae817441eb4394c6259c412a42403f71330319e2d97757088c380652c12e`, verified its public bytes and cleanly skipped a repeat. Existing published versions remain usable. The publisher also preserves older verified aggregate provenance when a later metadata-only cache observation lacks a score, and prevents interrupted/concurrent jobs from shortening known author lists.

Six safe additive migrations and the existing `hardcover` Edge Function are deployed on `xxijxuekfsxuzhnujqem`; real rolled-back Postgres contracts and anonymous denial checks passed. Security advisors found no issues. Gemini configuration, billing and grounding were unchanged; no Gemini request was needed for this phase. Aggregate-use permission conclusions are documented above; images, individual reviews and reading histories are excluded.

The preserved Hardcover budget recorded **56 reserved query units on 12 October UTC**, below its 500-unit application cap and the provider's free 5,000-unit limit. This is the global day's reservation total, not a claim that every unit was consumed by this phase or by the upstream provider. The APK is 180,411,445 bytes, SHA-256 `529d0cd498db94b8343a7a5bcd44a71853c0985e7bdff090c2f27ea514062631`.

[APK v1.4.0 / versionCode 6](https://github.com/Juvialski/Bookmarkit/actions/runs/38203309478/artifacts/11726728242) was reused only after verifying unchanged mobile build inputs/recipe. [Native upgrade/cache evidence](https://github.com/Juvialski/Bookmarkit/actions/runs/38207013909) passed. The first native failure was an incomplete injected author name; the harness now verifies the complete field before submission rather than treating a truncated query as a valid test.

Remaining limits: 9,012 works still lack author names; most long-tail works have no rating. Recent-title/provider aliases can be declined rather than guessed. Bulk edition selection is bounded and may need to replay a compressed prefix; it is not a complete editions-dump import. Standalone/planned-sequel author evidence is retained independently of provider grouping, and unresolved classification stays unknown. Physical-device acceptance remains separate. Exact-head CI and PR merge status are recorded in PR #18.
