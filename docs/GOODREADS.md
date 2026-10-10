# Goodreads cache and collector

## Availability verdict — 11 October 2026

Goodreads collection is **blocked for ongoing use** on this Windows host. A
preflight ISBN lookup succeeded for The Hunger Games. The subsequent 100-book
pilot stopped after three consecutive AWS WAF blocks: 0 verified / 3 attempted,
97 left untouched, mean 25.38 seconds per attempted book. This is not a completed
100-book benchmark and cannot establish catalog-wide precision or coverage.
No site protection was bypassed, and no Scrapy/Crawlee or browser solver was added.
Changing parsers would not resolve the observed access restriction.

The successful preflight record was recovered from the CLI's existing SQLite
store without another Goodreads request. Its exact ISBN, title, author, Open
Library work and edition were independently checked against current Open Library
endpoints. It was synchronized and included in the small bundled catalog:
**4.36 / 5, 10,311,943 ratings**, retrieved 11 October 2026 at 06:48 Manila time.
These are recorded observations, not fixed expectations about future Goodreads ratings.

Machine-readable evidence: [pilot](evidence/goodreads/pilot.json),
[hosted authorization/upsert](evidence/goodreads/hosted.json),
[Open Library linkage](evidence/goodreads/openlibrary-link.json),
[reviewed summary](../catalog/goodreads.json). Pilot metrics exclude the preflight.

## CLI audit

Audited [tamnd/goodread-cli](https://github.com/tamnd/goodread-cli), main commit
`05af9312a0816521e30481c4b5eff7c8adf9c63d`, and release **v0.3.1**
(`8974de32cd6278c334bccf6b542ce877dd0d3983`). Apache-2.0 applies to the CLI code;
it does not establish a license for Goodreads content. Source installation needs
Go 1.26; this machine used the Windows amd64 release ZIP, checked against the
release's `checksums.txt`. No binary or dependency was committed.

Use `lookup <isbn-or-title>` rather than passing ISBN to `book`: release `book`
expects a Goodreads ID/URL. `lookup` uses the public autocomplete endpoint and
then allowed book pages. `--limit 2` exposes duplicate candidates; multiple trusted
matches are rejected rather than choosing the first result. No `--no-robots`,
cookies, browser automation, review crawling or bulk crawl command is used.

Output is a book/work bundle with `legacy_id`, `web_url`, `isbn13`, contributor
roles, series references, `stats`, field provenance (`level`, `via`) and retrieval
time. **The README's edition-population claim is not trustworthy for v0.3.1**:
`WorkFrom` and `BookFrom` call the same `statsFrom`, whose Apollo numbers are read
from `Work.stats`. The importer accepts only Apollo level-1 work aggregates and
verifies the book's KCA work reference against the emitted work ID. JSON-LD/HTML
fallback statistics are excluded because their population is not proven.
Edition summaries are separately scoped in storage and the app, but this audited
collector never invents edition statistics from the work aggregate.

The CLI has a SQLite graph/store and disk page-cache configuration (24-hour
default TTL). Bookmarkit's queue avoids recollection until 30 days, and refreshes
the page cache after its normal expiry. `--retries 0` disables HTTP retry loops.
Actual blocking exits in this release were nonzero **1**, despite README text
mentioning 4; the wrapper also recognizes block/WAF/challenge/robots messages.

## Mobile and offline behavior

The app requests only cached Supabase summaries within the existing 1.8-second
catalog deadline. Missing tables, timeouts, blocked collection and empty caches
retain normal results. Goodreads never runs on the phone. Verified rating
priority is Goodreads, live Hardcover, live Open Library, live Google Books,
then stored fallback. Goodreads averages use two decimals and the existing five
proportional golden stars. Counts come from the same selected source.

“Read Goodreads Reviews” uses the verified exact book URL, otherwise the existing
ISBN/title-author search. Known classification is preserved; verified Goodreads
series metadata supplements only an unknown classification.

The optional `books.goodreads_json` column leaves schema v3 and legacy files
compatible. Edition summaries apply only to exact ISBN results, never work-only
search results. Monthly publishing reads verified summaries from the public cache
with a bounded optional fetch before checksumming the SQLite file. Failure does
not block publishing the Open Library catalog. Existing checksum/integrity,
atomic installation and previous-version recovery are unchanged. No reviews,
descriptions or scraped images are included in a snapshot.

## Storage and authorization

The additive `goodreads_summaries` table has book-ID deduplication, work/ISBN
indexes, explicit population, source URL, successful retrieval, confidence and
evidence. RLS/grants allow public reads and deny client writes. Existing catalog
identities, provider ratings and classifications are untouched. The missing
Hunger Games work/edition/ISBN were added separately, after authoritative Open
Library verification, using insert-on-conflict-do-nothing.

`goodreads-ingest` requires a random 256-bit collector credential. Supabase holds
only its SHA-256 hash; Windows holds DPAPI ciphertext restricted to the current
user. No service-role key is stored in the worker or APK. The Edge Function limits
batch size/body bytes and validates fields; its service-only RPC verifies known
catalog linkage and title/author evidence. Upserts reject identity changes and
ignore older observations. Checkpointed upload retries acknowledge only successful
batches. Credential rotation is explicit: rerun provisioning; revoke by clearing
or rotating the server hash.

The table/function are deployed to `xxijxuekfsxuzhnujqem`; authorization and one
real idempotent upload were exercised. This does not establish sustained collection.

## Windows operation

All commands below run from the repository root. Install Python and download the
audited CLI release; verify its ZIP checksum before extraction. In this session,
the binary is under ignored `dist/goodreads-tools/bin/goodread.exe`.

```powershell
# Prepare the persistent queue without network access.
python scripts/goodreads_worker.py --state "$env:LOCALAPPDATA\Bookmarkit\Goodreads" --seed catalog/source.json --limit 100
# Explicit pilot only; stop immediately with PAUSE/STOP files.
python scripts/goodreads_worker.py --state dist/goodreads-pilot --cli dist/goodreads-tools/bin/goodread.exe --pilot --seed catalog/source.json --limit 100 --report docs/evidence/goodreads/pilot.json
# Provision/rotate the scoped token and deploy ingestion using existing operator CLI auth.
python scripts/provision_goodreads.py --credential "$env:LOCALAPPDATA\Bookmarkit\Goodreads\collector-token.dpapi"
# Install ONLY after a future successful, independently adjudicated pilot.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/install-collector.ps1 -Python C:\path\python.exe -Cli C:\path\goodread.exe -PilotReport C:\path\passed-pilot.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/control-collector.ps1 -Action pause
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/control-collector.ps1 -Action resume
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/control-collector.ps1 -Action stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/control-collector.ps1 -Action remove
```

`-ExecutionPolicy Bypass` applies only to the launched process; no machine policy
is changed. A permanent task was **not installed**. The failed-pilot installation
gate and a silent startup respecting the durable circuit were tested locally.
Successful scheduler registration remains untested because the pilot failed.

The worker uses Idle priority, one CLI subprocess, at least 15 seconds between
book operations and CLI request spacing, no GPU/browser, a single-instance lock,
SQLite transactions, bounded logs, and one-second pause/stop polling. It requires
AC power and two minutes without user input; resource checks pause on high CPU,
Hubstaff and recognized game-launcher/game processes. Unknown readings pause.
These are conservative heuristics, not measured interference guarantees for every
game. Scheduler defaults also stop on battery and require idle operation.

Supply prioritized local targets with `--targets targets.json`: each object has
`work_id`, `isbn13` (or null), `title`, `authors`, `priority`. Priority 0 is a scanned
book missing Goodreads, 1 scanned stale data, 2 popular catalog, 3 remaining
catalog; verified records get a monthly refresh at 4. Automatic mobile-to-worker
enrichment requests are intentionally not activated while collection is blocked.
The queue retains last-good summaries on refresh failures and deduplicates by
work/ISBN. Network failures retry on later launches at most twice. Three consecutive
blocks persist a circuit across restarts; it is not cleared automatically.

## Validation boundaries

App unit tests cover preference, precision, exact redirects, series preservation,
edition isolation and legacy/offline compatibility. Collector tests cover duplicate
and conflicting identities, unproven population, interrupted resume, deduplication,
priorities and persistent blocking. Hosted tests cover unauthorized/wrong-token
requests, invalid payloads, denied anonymous SQL/RPC writes and real idempotency.

Android CI builds a fresh APK and exercises the actual bundled/hosted Goodreads
record, exact reviews intent, offline rendering and existing cover/OCR/scanner
flows on a disposable emulator. Physical-device and sustained background-resource
acceptance still require separate evidence. Different-language and obscure-title
precision remain unmeasured because the pilot stopped on blocking.
