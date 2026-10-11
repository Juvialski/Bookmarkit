# Hardcover ratings integration â€” 11 October 2026

**Implemented and deployed; authenticated Hardcover and cache observations verified.**
The user created and confirmed a free Hardcover account in the Al Chrome profile,
then authorized a read-only catalog PAT. It has only `read:catalog:data` and
`read:catalog:search`, expires 11 October 2027, and is configured as a Supabase
server secret. The temporary local transfer file was deleted. No token is in chat,
commits, mobile configuration or the APK. The additive migration and `hardcover`
Edge Function are deployed on `xxijxuekfsxuzhnujqem`. No paid plan was activated.
The mobile and bounded monthly enable variables are now set to `1`.

## Implementation and reuse

The existing ISBN GraphQL query/normalizer and result UI were retained. A shared
module now serves the existing optional Node proxy and a fixed-query Supabase
Edge Function. No Render service is necessary. ISBN responses include the actual
Hardcover edition ID and parent work; wrong ISBNs, disagreeing parent IDs and
multiple matching works are rejected. Work rating and rating count remain paired.

Live validation showed that the fuzzy search index includes study guides and
commentaries for popular novels. Title/author lookup therefore uses the official
GraphQL exact-title and author relationship filters, accepts only OK records with
no canonical-duplicate pointer, and fetches at most eight candidates plus one
truncation sentinel. It never chooses a work by popularity or rating count. A cold case-variant query
with no exact database rows can fall back to at most 25 search-index hits, only if
that is the complete returned set. At most eight exact normalized title/author
candidate IDs are hydrated from canonical GraphQL work records. Search-index
ratings are never imported. Truncation or ambiguity still declines the match. An exact normalized work title
and primary author are required. Multiple plausible IDs, truncated candidate
sets, conflicting duplicates and translations/subtitle differences are declined.
A work-only result carries no invented edition ISBN. Missing authors cannot
verify a match. Zero/malformed/missing counts suppress new Hardcover scores.

Cached Goodreads stays first. Hardcover is the strongest next online source,
followed by Open Library, Google Books and stored fallback. Scores/counts are
never averaged or mixed. Goodreads and Hardcover show two decimals with the
existing five proportional golden stars, attribution and actual selected count.
The Goodreads review button and scanner/result layout are unchanged.

Progressive ISBN lookup displays identified metadata before every rating call
finishes. Title/author lookup can return the first exact title/author provider
match; selected results subsequently receive missing Hardcover data. Same active
searches share the request. Identity filtering and the existing selection/abort
generation guards prevent another work or stale scan replacing the result.
The ISBN session cache expires after five minutes (30 seconds for incomplete
results), rather than retaining completed observations indefinitely.

## Official API audit

Audited official documentation repository commit
`e6e5abf0c628286b2a5d82cbe07c49838cf59f92`, including getting-started, search,
Books/Editions/Contributions/BookSeries/Images schemas and scope capabilities.
[Setup and conditions](https://docs.hardcover.app/api/getting-started/),
[search](https://docs.hardcover.app/api/guides/searching/),
[official source](https://github.com/hardcoverapp/hardcover-docs/tree/e6e5abf0c628286b2a5d82cbe07c49838cf59f92).

Use a server PAT with `read:catalog:data` and `read:catalog:search`; no account,
library, review, user-rating or mutation scopes are required. Tokens may expire
or be reset while the API is in beta. The endpoint is
`https://api.hardcover.app/v1/graphql`, with server-only Bearer authorization.
The current free plan lists 5,000 top-level queries/day, burst 10 and 60/minute.
Each top-level field consumes one unit. The final ISBN and exact-title queries
use one unit for ISBN and one to three units for cold title lookup. Title lookup
conservatively reserves three units in advance; cached reads consume none.
Search's documented timeout is two seconds; general queries allow 30 seconds,
but this integration uses much shorter deadlines. No subscription is activated.

Official conditions permit attributed aggregate data such as the average
Hardcover rating. Individual user-owned ratings, reviews and reading data are
excluded. Images are user uploads and public use requires a takedown policy;
image licensing is not guaranteed by an API URL. This implementation retains
cover URLs for online book metadata, but **does not ship image URLs or images
in offline snapshots**. The repository [content policy](CONTENT-POLICY.md) provides a takedown/reporting
route; it does not claim that third-party images are copyright-cleared. No user library data, reviews or LLM-training use occurs.

## Backend, cache and authorization

The additive migration introduces separate `hardcover_cache`, `hardcover_jobs`
and `hardcover_budget` tables. Goodreads/catalog identities are not overwritten.
Cache records retain the book ID, verified edition/ISBN identity, optional
independently established Open Library work ID, aggregate pair/scope, URL/cover,
series, successful retrieval, match evidence and seven-day expiry.
Open Library mapping is assigned only when an existing catalog ISBN/edition/work
link and catalog title/author agree; a caller cannot supply a work mapping.

Cache rows are publicly read-only under explicit grants/RLS. The queue and
budget are private. All writing/reservation RPCs are service-only, security
invoker and use an empty search path. Identity conflicts cannot overwrite cached
work/ISBN/title/author assignments; older observations cannot replace newer ones.

The Edge Function accepts only the project's public publishable key and a small
validated ISBN or title/author object. This key is admission, not a secret or user
identity. There is no arbitrary GraphQL, URL, user-data or mutation proxy.
It enforces a 2 KiB/one-second input-body bound, 64 KiB work JSON / 256 KiB search-index JSON bounds,
2.2-second upstream calls and 1.8-second database calls. Mobile enrichment has a
six-second deadline and never holds the initial cached result behind that call.

Database reservations protect the shared PAT across isolates: **500 query units/
UTC day**, one unit per three seconds (20/minute), a 15-second per-key lease and
at most 2,000 distinct queued query identities. Concurrent duplicate requests
coalesce within an isolate; cross-isolate duplicates fail fast under the lease.
429 `Retry-After`, exhausted daily `RateLimit` headers and invalid/expired/scope
errors persist cooldowns. There are no inline retries or rotating credentials.
Misses wait five minutes; errors wait one hour. A lost lease is not a successful
lookup. Existing cached successes survive subsequent refresh errors.

## Monthly/offline enrichment

No 25,000-request collection was introduced. The existing monthly job can drain
at most 25 due jobs over at most two minutes, while the same server safety budget
remains authoritative. Recently scanned queries are priority 0, up to 20 popular
catalog seeds priority 1, verified refreshes priority 2, and operator-supplied
remaining records priority 3. Failed automatic jobs stop after three attempts;
queue state/checkpoints remain in Supabase. Fresh cache hits advance monthly
checkpoints to their existing expiry instead of repeatedly occupying the due queue. No new recurring workflow is added.

The operator variable `HARDCOVER_ENABLED=1` enables that optional drain. It is
now configured. Missing credentials, missing functions, rate limits and provider
outages skip enrichment and keep normal monthly publication working.
Optional cached aggregate records are attached in a `hardcover_json` column,
then the staging database is rechecksummed before validation/publication.
Schema v3 and old catalogs without this column remain compatible. Source and
scope attribution survive offline lookup; embedded Goodreads records are retained.
Only independently mapped cached data is eligible for download; no requests to
Hardcover are made merely to build the offline snapshot.

## Validation and current evidence

Local mobile/server and snapshot tests verify the normalized ISBN/work contracts,
title/primary-author matching, duplicates, conflicting parent works, count/scope
agreement, source priority/Goodreads precision, cache TTL, input restrictions,
coalescing, deadlines, rate-limit cooldowns, progressive metadata, stale selection
guards, reviews links and legacy/snapshot compatibility. Synthetic fixture values
such as 4.56 / 18,432 are **not observed Hardcover ratings**.
Current local results: **99 mobile tests, 45 server tests and 2 snapshot tests
passed**, along with lint, typecheck and Deno Edge typecheck. The real SQL
transaction evidence is [recorded separately](evidence/hardcover/hosted-rollback.json).

Using actual bundled rows and public fallback APIs on Windows, the progressive
Node code path returned initial ISBN results in **57.94 ms** (Hunger Games),
**3.18 ms** (Warbreaker) and **1.39 ms** (Way of Kings). Full enrichment completed
in 3,074.70 / 949.11 / 1,036.28 ms respectively. The exact Way of Kings title/author
search returned in **253.31 ms**. These are [Node-path measurements](evidence/hardcover/fallback-latency.json)
with real stored data, not native render timings, fixtures or Hardcover API timings.
The observed Goodreads score/count remained selected after enrichment.

Hosted PostgreSQL executed the new schema and contract tests **inside a rolled-back
transaction**: public cache reads, denied client writes/RPCs/private queue reads,
identity conflict rejection, leases, spacing, daily budget and cooldown checks
passed. This proves real SQL authorization behavior, **not a deployed cache or live
provider lookup**. No synthetic rating survived that transaction. CI also runs
the contract against an isolated PostgreSQL 17 service.

The initial authenticated sample tested **20 distinct books on both ISBN and
title/author paths (40 queries)**. ISBN: 18 found, **15/20 strict independent
title/author agreements**; three alternate title/subtitle differences are not
counted as strict matches. Title/author: **10/20 verified**. Either path strictly
identified **17/20 (85%)**. This development sample spans multiple server revisions
and includes the discovery issue that prompted the final exact-title/canonical
query; it is not a fixed-head precision claim. Median lookup latency was 1,823.315
ms for ISBN and 1,681.895 ms for title; median verified repeated cache requests were
443.425 / 555.865 ms. [Full sanitized observations](evidence/hardcover/live-initial.json).

A second Hunger Games ISBN returned a distinct edition (8717381 versus 1589497)
under the same work 88639 and the same work rating/count pair. An explicit wrong
author was declined. Cold title-only validation verified The Rosie Project from
Graeme Simsion without any prior ISBN cache record: **3.863934… / 610 ratings**,
Don Tillman #1, at 1,931.2 ms. [Cold-title evidence](evidence/hardcover/final-cold-title.json).
The final `76d21a6` serving-path check completed 40 HTTP 200 responses for a
20-book cohort: **19/20 title/author matches and 19/20 strict books through at
least one path**. All 20 ISBNs returned a record, but three alternate title/subtitle
differences remain excluded (17/20 strict ISBN agreements). Median lookup was
**531.69 ms ISBN / 569.945 ms title/author**, predominantly persistent cache reads.
This cohort replaces two initial classical misses with the already-tested Project
Hail Mary and Night Circus; it is not a random catalog-wide sample. Across all 25
unique titles attempted during development, the final lowercase correction brings
strict matches through at least one path to **22/25 (88%)**; the remaining gaps are
Babel, Pride and Prejudice and Emma. [Summary](evidence/hardcover/live-summary.json),
[all final queries](evidence/hardcover/live-final-cache.json),
[final cohort](evidence/hardcover/final-target-titles.json).

Fresh title-only requests also verified Project Hail Mary, Night Circus and
Outlander on the final canonical query. A Secret History request was refused by
its existing retry cooldown; that circuit was not cleared. After normal expiry,
`the secret history / donna tartt` verified a cold work without an ISBN or prior
positive cache: 4.074969... / 1,634 ratings, in 5,290.33 ms. This case used canonical
hydration, not search-index ratings. [Lowercase live evidence](evidence/hardcover/lowercase-live.json).
[Final cold title evidence](evidence/hardcover/final-title-verification.json).

The [installed authorization checks](evidence/hardcover/hosted-authorization.json)
returned 200 for public cache reads and 401 for anonymous writes, privileged RPCs,
private queue reads and wrong-key Edge requests. Supabase security advisors reported
no issues. A scratch snapshot attached the one independently mapped work to eight
ISBN rows, passed SQLite integrity and retained Goodreads unchanged; the production
catalog was not modified. [Snapshot evidence](evidence/hardcover/offline-snapshot.json).

No HTTP 429 quota exhaustion occurred; the budget remained well below the free
limits. Additional ambiguous/missing records are declined, not filled with guessed
scores. The server cache and live provider evidence are distinct from fixtures. The reproducible small acceptance script
selects 15-25 diverse catalog books and both recognition paths, records identities,
pair/scope, series/cover, API errors, lookup/cache-hit latency, and stops immediately
on authentication or rate-limit failures:

```powershell
python scripts/validate_hardcover_live.py --titles docs/evidence/hardcover/final-target-titles.json --output dist/hardcover/live.json
```

The enabled standalone **1.2.0 / versionCode 4** APK was built in
[run 38103758594](https://github.com/Juvialski/Bookmarkit/actions/runs/38103758594).
[Direct APK artifact](https://github.com/Juvialski/Bookmarkit/actions/runs/38103758594/artifacts/11689256311):
180,392,225-byte APK, SHA-256
`4b346be76fde99abbf18c1a3118cd4dd40e07cb3f1a3c25a72588f9420abe6d0`.
The first native run installed it successfully over immediately previous main
version 3, then stopped at an outdated harness assertion expecting version 3.
The assertion now checks the configured version and a strict version increase;
the same APK is reused for the corrected acceptance run because mobile inputs
and the build recipe are unchanged. Final emulator results will be linked in the PR. No physical-phone acceptance
is implied by emulator evidence.

## Configuration and operational follow-up

The deployed server PAT is read-only and expires 11 October 2027. Rotate it in
Supabase before expiry; beta token resets may require earlier rotation. The app
uses only the public project key and HTTPS Edge URL. No Render service is needed.
The existing compatibility Node proxy remains available for existing deployments,
but is not the production backend for this phase.

Keep `EXPO_PUBLIC_HARDCOVER_ENABLED=1` for release builds and
`HARDCOVER_ENABLED=1` for bounded monthly enrichment. Set them to `0` to pause new
provider enrichment without deleting last-good records or disrupting the other
providers. Never clear cooldowns simply to force acceptance. Cache identity
conflicts remain operator-review items. The initial SQL contract was rolled back;
the separately applied additive migration and real provider observations now
persist. Exact-head CI, the enabled APK and emulator evidence are required before
merge; physical-phone acceptance remains separate.
