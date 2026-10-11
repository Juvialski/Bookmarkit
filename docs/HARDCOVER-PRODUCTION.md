# Hardcover ratings integration — 11 October 2026

**Implemented, credential-gated; live Hardcover production acceptance is blocked.**
No `HARDCOVER_API_TOKEN` exists in authorized project environment files, process/
user/machine environment, GitHub project secrets or Supabase project secrets.
The Supabase operator connection is available. No Hardcover API request was made,
no paid service was enabled and no provider credential is bundled in mobile code.
The mobile enable flag remains unset and existing sources continue operating.

## Implementation and reuse

The existing ISBN GraphQL query/normalizer and result UI were retained. A shared
module now serves the existing optional Node proxy and a fixed-query Supabase
Edge Function. No Render service is necessary. ISBN responses include the actual
Hardcover edition ID and parent work; wrong ISBNs, disagreeing parent IDs and
multiple matching works are rejected. Work rating and rating count remain paired.

Title/author lookup uses Hardcover's documented `search` field, at most eight
candidate IDs, then a fixed book-details query. An exact normalized work title
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
Each top-level field consumes one unit, so title search reserves two units.
Search's documented timeout is two seconds; general queries allow 30 seconds,
but this integration uses much shorter deadlines. No subscription is activated.

Official conditions permit attributed aggregate data such as the average
Hardcover rating. Individual user-owned ratings, reviews and reading data are
excluded. Images are user uploads and public use requires a takedown policy;
image licensing is not guaranteed by an API URL. This implementation retains
cover URLs for online book metadata, but **does not ship image URLs or images
in offline snapshots**. Before public activation, establish the required image
takedown contact/policy. No user library data, reviews or LLM-training use occurs.

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
It enforces a 2 KiB/one-second input-body bound, 64 KiB upstream JSON bound,
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
queue state/checkpoints remain in Supabase. No new recurring workflow is added.

The operator variable `HARDCOVER_ENABLED=1` enables that optional drain. It is
currently unset. Missing credentials, missing functions, rate limits and provider
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

Hosted PostgreSQL executed the new schema and contract tests **inside a rolled-back
transaction**: public cache reads, denied client writes/RPCs/private queue reads,
identity conflict rejection, leases, spacing, daily budget and cooldown checks
passed. This proves real SQL authorization behavior, **not a deployed cache or live
provider lookup**. No synthetic rating survived that transaction. CI also runs
the contract against an isolated PostgreSQL 17 service.

Live API coverage: **unmeasured, zero authenticated Hardcover test books**. Live
lookup/cache hit latency is unmeasured. The reproducible small acceptance script
selects 15–25 diverse catalog books and both recognition paths, records identities,
pair/scope, series/cover, API errors, lookup/cache-hit latency, and stops immediately
on authentication or rate-limit failures:

```powershell
python scripts/validate_hardcover_live.py --output dist/hardcover/live.json
```

APK/native acceptance results and artifact links will be recorded with the PR
once its cloud build and emulator checks complete. No physical-phone acceptance
is implied by emulator evidence.

## Remaining activation steps

1. Configure `HARDCOVER_API_TOKEN` server-side in Supabase project
   `xxijxuekfsxuzhnujqem` with the two catalog-read scopes. Do not paste it into
   mobile configuration, GitHub public variables, logs or this document.
2. Apply the additive migration through the operator's normal migration process.
   Deploy only `hardcover` with `--project-ref xxijxuekfsxuzhnujqem --no-verify-jwt
   --use-api`. The function validates publishable-key admission itself; private
   RPC grants and shared budgets remain authoritative.
3. Execute the small live acceptance set, inspect identity rejections and verify
   the real cache-hit path. Confirm source/image conditions before public use.
4. Only after that succeeds, set `EXPO_PUBLIC_HARDCOVER_ENABLED=1` for mobile
   builds and `HARDCOVER_ENABLED=1` for optional monthly work; create the enabled
   standalone APK and repeat native acceptance. No provider token is needed on
   the phone or in the Actions build.

The delivered default APK leaves live Hardcover disabled because this credential
gate is unresolved. Existing Goodreads/Open Library/Google Books and offline
results remain available. Merge/production-readiness must not be claimed merely
from fixture tests when authenticated deployment acceptance remains blocked.
