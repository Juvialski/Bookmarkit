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

Final measured counts, publication, CI, emulator and APK links are recorded below when those checks complete.
