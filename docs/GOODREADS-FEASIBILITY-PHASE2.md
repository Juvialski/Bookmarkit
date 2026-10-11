# Goodreads feasibility Phase 2 — 11 October 2026

**NO-GO for unattended Goodreads collection or production historical import.**
The broader GitHub Actions experiment hit three consecutive WAF blocks after
three accessible pages. Only two pages passed identity and rating checks. The
original goodbooks XML provides mathematically consistent historical work scores,
but only **8/25,265 works (0.0317%)** in the expanded catalog have corroborated
identity matches. Underlying content reuse permission remains unresolved, so
**zero historical records are approved for production**.

Base: PR #14 merged as `0cae652be8a05c6df8b383dccb859398f0767bdd`.
Read its [findings](GOODREADS-SCRAPING-FEASIBILITY.md), [collector audit](GOODREADS.md),
parser, tests and evidence before this phase. This phase modifies research scripts,
documentation and minimal CI only. No app/APK, production rows, Windows collector
circuit/task, Gemini settings or monthly publication workflow changes.

## GitHub Actions experiment

New hypothesis: the earlier four accessible runner pages will generalize to a
broader, diverse target set. **Not supported by this run.**

[Run 38099877727](https://github.com/Juvialski/Bookmarkit/actions/runs/38099877727)
used Ubuntu 24.04, Python standard library, anonymous identified urllib requests,
the existing Apollo/JSON-LD parser and no credentials, Chrome, proxies or retries.
Collector commit: `8cb5eabe24f7f0741468369f4aea277e88d2507b`.
The workflow itself succeeded because it completed the bounded measurement;
the collection verdict is blocked.

[26 fixed targets](evidence/goodreads/phase2-targets.json) form two disjoint
13-page subsets. Original Goodreads XML supplies exact page URLs, book/work IDs,
author and unrounded ISBN expectations for older books. Four post-2017 pages are
Phase 1 discovery candidates with independently checked Open Library ISBN/work
identity; they are **not presumed verified Goodreads mappings**. Only an exact
ISBN/title/author match on the fetched page could accept them. The second Hunger
Games edition is independently linked by Open Library ISBN `9780545229937` to
Goodreads `7107665` and OL5735363W. No search-result score is accepted.

The set spans classics, modern fantasy, romance, YA, standalone and series books,
older and 2020–2023 publications. The Divan and Diary ng Panget had only 6,325 and
7,045 historical work ratings, respectively, and provide less-popular controls.
Multiple editions are explicitly included. These attributes describe **selection**;
the circuit stopped before most categories were requested.

| Measurement | Result |
| --- | ---: |
| Selected pages | 26 |
| Selected in subset A | 13 |
| Actually attempted book pages | 6 |
| HTTP 200 pages | 3/6 = 50% |
| WAF/access challenges | 3/6 = 50% |
| Accepted identity + rating pairs | 2/6 = 33.33% |
| Accessible pages accepted | 2/3 = 66.67% |
| Identity rejection | 1: Pride and Prejudice ISBN mismatch |
| Unrequested after stopping | 20 (7 remaining A, all 13 B) |
| Additional robots request | 1, HTTP 200 |
| Python wall time including spacing | 93.237 seconds |
| Python process CPU | 0.1251 seconds |
| Peak Python resident memory | 41.66 MiB |
| Runner job start-to-completion | 102 seconds, approximately 1.7 runner minutes |
| Workflow created-to-completed | 105 seconds |
| Artifact ZIP | 1,188 bytes; 14-day retention |

All request attempts were sequential, separated by at least 15 seconds; no block
was retried. Three consecutive HTTP 202 WAF challenges opened the durable local
research circuit. **Subset B and any additional Goodreads testing were cancelled.**
No challenge was executed or bypassed. No Goodreads requests were made locally.

| Attempt | Page | HTTP | Latency | Result |
| --- | --- | ---: | ---: | --- |
| 1 | Hunger Games, 2767052 | 200 | 1.181 s | Verified |
| 2 | Pride and Prejudice, 1885 | 200 | 0.911 s | Edition/ISBN mismatch rejected |
| 3 | Outlander, 10964 | 200 | 0.863 s | Verified |
| 4 | Fault in Our Stars, 11870085 | 202 | 0.074 s | WAF blocked |
| 5 | Martian, 18007564 | 202 | 0.013 s | WAF blocked |
| 6 | Road, 6288 | 202 | 0.015 s | Third block: stop |

| Verified book / author | ISBN | Goodreads work | Average | Ratings | Series |
| --- | --- | --- | ---: | ---: | --- |
| [Hunger Games / Suzanne Collins](https://www.goodreads.com/book/show/2767052-the-hunger-games) | 9780439023481 | 2792775 | 4.36 | 10,312,057 | Hunger Games #1 |
| [Outlander / Diana Gabaldon](https://www.goodreads.com/book/show/10964.Outlander) | 9780440242949 | 2489796 | 4.27 | 1,189,011 | Outlander #1 |

Observations: **08:52:28 and 08:53:00 Manila, 11 October 2026**, not fixed live
expectations or guarantees of upstream freshness. Both pairs come from resolved
Apollo `Book.work -> Work.stats`, cross-checked with JSON-LD `ratingValue` and
`ratingCount`. `reviewCount` is never substituted. Book ID, work ID, primary author,
title, exact ISBN and canonical URL agree with target metadata. The full sanitized
[runner result](evidence/goodreads/phase2-runner-a.json) retains series placements,
retrieval timestamps, population evidence, per-request CPU and rejection reasons.

## Repeatability and manual reproduction

Phase 1's 4/4 accessible runner pages and this run's 3/6 demonstrate that access
is intermittent; they do not establish independent-day reliability. Same-day
Hunger Games was accessible again, but that single repeat cannot support general
availability. A second run after the observed circuit trip would waste requests
and violate this phase's stop condition, so it was not performed.

The retained [manual workflow](../.github/workflows/goodreads-research-temporary.yml)
has **only `workflow_dispatch`**, no schedule, push or PR collection trigger. It
reuses the previously registered temporary workflow path. A future explicitly
authorized another-day comparison can dispatch an unrequested subset:

```powershell
gh workflow run goodreads-research-temporary.yml --ref main -f subset=b
gh run list --workflow goodreads-research-temporary.yml --limit 5
gh run download <run-id> --dir dist/phase2/another-day
```

Use the branch ref instead of main before merge. Check the most recent artifact
first; do not retry blocked URLs or launch multiple subsets after a block circuit.
Keep the fixed target file unchanged for comparisons and record run ID, code SHA,
target hash, timestamp, runner and denominators. An another-day result remains
**unmeasured**. Manual dispatch does not make this an unattended pipeline.

Local research checkpoints atomically save each attempt before requesting it.
Resume skips completed and interrupted-in-flight URLs, rejects changed targets,
and retains an opened circuit. PAUSE/STOP files prevent requests. An unknown
interrupted response is left unresolved rather than automatically retried. These
controls operate within the research output directory; the Windows worker state
is never accessed. Cross-run state is **not** automatically shared between fresh
Actions runners: the operator must inspect prior artifacts before dispatch.

## Historical source, population and reuse

The [publisher README](https://github.com/zygmuntz/goodbooks-10k/tree/6dd165b555a7b47b2dd36743a425776e641ff50c)
identifies Goodreads XML as the metadata source. Original archive:
[`books_xml.zip`](https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/6dd165b555a7b47b2dd36743a425776e641ff50c/books_xml/books_xml.zip),
55,777,086 bytes, SHA-256
`f9724dddfbd4d744e97977c4d631684b2aa238739893749ffc66b7cb8f5f3a66`.
The archive's last change was [16 November 2017](https://github.com/zygmuntz/goodbooks-10k/commit/8290077d92f858a99ccc3b5126b8667430c24d2d),
correcting the XML archive. This establishes a **2017 snapshot era**, not an exact
collection time per record. We reused the hash-verified archive downloaded in Phase
1; no user ratings, reviews, descriptions or images were redistributed.

New hypothesis: XML `average_rating` describes the work population. For **all
10,000 records**, the five star buckets sum to `work/ratings_count`, their weighted
sum equals `work/ratings_sum`, and that sum divided by that count, rounded to two
decimals, equals `average_rating`. Thus XML offers internally proven work average/
count pairs. **9,986/10,000 book/edition counts differ from work counts**. Never pair
the work average with top-level book `ratings_count`, or mix CSV and XML values.
9,371 XML ISBN-13 strings pass checksum validation; 629 are missing/invalid. CSV
floating/scientific notation is never repaired or used as an exact ISBN.

The [publisher license](https://github.com/zygmuntz/goodbooks-10k/blob/6dd165b555a7b47b2dd36743a425776e641ff50c/LICENSE)
declares CC BY-SA 4.0. Its [requirements](https://creativecommons.org/licenses/by-sa/4.0/)
include attribution, indicating changes and ShareAlike for adaptations. It does
not establish that the publisher obtained all underlying Goodreads permissions.
[Current Goodreads terms, sections 1 and 4](https://www.goodreads.com/about/terms)
restrict automated extraction and reuse. Robots allowance and public accessibility
do not grant content redistribution rights. No written permission was established
in this phase. Consequently this is **experimental quarantined metadata**, not a
licensed production bootstrap; source permission is an independent integration gate.

## Full expanded-catalog comparison

Audited **every work and ISBN** in `catalog/packages/expanded.db`, the committed
2026-10 expanded package, rather than the separate 1,115-work popular seed used in
Phase 1. Its manifest reports 25,265 works, 26,464 ISBNs and 31,838,208 bytes;
SHA-256 `ba7b45949586e03c9be2f747bd297053dfd84b3b464d2142e24b3602592c9b70`.
The offline job opens it read-only and does not alter it. The checked package is
the scope of these counts, not a fresh export of hosted production rows.

Only 4,355/26,464 edition rows contain authors. Only **11 distinct original XML
ISBNs overlap** this package. Accordingly the previous 7/20 popular-book result
does not generalize to the full expanded package. ISBN checksum alone is not
sufficient: identities and independent work links must agree.

Priority 1 uses original exact checksum-valid ISBN and compatible title/author;
missing authors cannot prove a match. Priority 2 accepts explicit independently
corroborated work mappings. Priority 3 requires strict normalized title and author
and stays candidate-only. Normalization removes accents/punctuation and an explicit
trailing numbered series marker while preserving non-Latin letters; there is no
fuzzy title or author selection. Non-Latin identities cannot collapse into empty
strings and falsely match unrelated records.
Conflicting source book IDs and multiple catalog works mapping to one Goodreads
work are rejected. Edition-specific ISBN mappings never transfer to another edition.

The initial offline-only pass accepted **one** ISBN match. A separate bounded
Open Library check made **35 public endpoint requests across the 11 overlaps**
(ISBN edition, catalog work and work authors, with caching), recovering evidence
for missing-author and shortened-title records. The corroboration requires current
ISBN membership, catalog work linkage and author agreement, plus compatible titles
or explicit edition Goodreads ID agreement. All eight accepted matches also have
the expected Goodreads book ID in the current Open Library edition identifiers.
These checks do not repair the catalog or establish publisher data freshness.

| Full catalog classification | Works |
| --- | ---: |
| Exact ISBN + compatible/corroborated identity | 8 |
| Independently validated work matches (subset of those 8) | 8 |
| Additional Priority 2 work-only matches | 0 |
| Strict title/author candidates requiring validation | 16 |
| Ambiguous title/author candidate | 0 |
| Title-only, missing-author records (unvalidated) | 163 |
| Conflicts rejected | 3 |
| No candidate | 25,075 |
| Total | 25,265 |
| Mathematically usable matched historical pairs | 8 |
| Approved production historical ratings | **0** |

The 8 matched works are David Gets in Trouble, Tales of the South Pacific, Attack
of the Fiend, If You Give a Pig a Party, Peace Like a River, Crank, Wicked and The
Descendants. The Pigeon Wants a Puppy and Rich Dad's Cashflow Quadrant have current
Open Library ISBN-to-work linkage conflicts; Maximum Ride has title/contributor
differences (NaRae Lee versus James Patterson). All three are excluded.
[Independent public identity evidence](evidence/goodreads/phase2-openlibrary.json)
records accepted and rejected overlaps. No conflicting data was silently corrected.

**Verified metadata coverage: 0.0317%.** Even all 179 unresolved title candidates
would not support a thousands-of-works claim. They are not accepted ratings.
This phase does not independently validate title-only candidates or extrapolate
their apparent matches to import coverage.

## Local quarantined prototype and reproducibility

[Historical script](../scripts/goodreads_historical.py) parses all original XML,
checks population and reconciles the entire SQLite package offline. Separate
ignored JSON/SQLite outputs contain book/work IDs, exact catalog mapping, average,
work count/scope, historical status, `snapshot_era=2017`, unknown exact source
retrieval time, source identifier/hash and match confidence. Source download time
is never used as rating retrieval time. No live-summary table or catalog file is
written; every prototype record has `production_eligible=false`.

Dry run: **8 inserts; rerun 0 inserts/8 unchanged; altered-count attempt 1 conflict,
0 overwrites**. A unique Goodreads book-ID constraint also rejects one source book
being imported under another catalog identity. No historical score is combined
with a current count or presented as a live observation.

Compact prototype payloads total **5,290 bytes**. The measured separate quarantine
SQLite file is **24,576 bytes** (16,384-byte empty indexed schema plus 8,192 bytes
of added data pages), an estimated **0.0772%** additional offline file size relative
to the current catalog. These figures are in the [full report](evidence/goodreads/phase2-historical.json).
They estimate the added offline file cost for these eight records, not a production
schema migration or a 10,000-record storage projection. The production catalog's
actual size increase is **zero**.

```powershell
# Download only the original public metadata archive into ignored storage.
New-Item -ItemType Directory -Force dist/phase2 | Out-Null
Invoke-WebRequest 'https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/6dd165b555a7b47b2dd36743a425776e641ff50c/books_xml/books_xml.zip' -OutFile dist/phase2/books_xml.zip
# Uses committed independent evidence; reconciliation makes ZERO HTTP requests.
# Use a fresh output directory; existing scratch databases are refused.
python scripts/goodreads_historical.py --xml dist/phase2/books_xml.zip --mappings docs/evidence/goodreads/phase2-openlibrary.json --output dist/phase2/reproduced
# Optional bounded refresh of only the ISBN overlaps; no Goodreads traffic.
python scripts/goodreads_verify_overlap.py --xml dist/phase2/books_xml.zip --output dist/phase2/refreshed-mappings.json
python -m unittest discover -s scripts -p test_research_goodreads.py
python -m unittest discover -s scripts -p test_goodreads_phase2.py
```

The archive hash is enforced. Committed reports contain sanitized counts and
identity evidence; raw source archive, per-work reconciliation, quarantine JSON
and SQLite remain under ignored `dist/`. The offline full pass took **10.526 seconds**
on this host.

## Hosting comparison and defensible architecture

| Approach | Verified availability/coverage | Cost and maintenance | Verdict |
| --- | --- | --- | --- |
| A: Actions collector | 2 verified / 6 attempted in this phase; access circuit tripped | Public standard Ubuntu runner has free compute; low CPU, no laptop involvement; manual identity review and intermittent blocks remain | Best environment for future small authorized experiments; NO-GO unattended |
| B: Windows worker | Earlier 0/3 pilot plus 2/6 Phase 1 direct verified pages; durable circuit remains blocked | No hosting fee, but laptop uptime and idle/game/Hubstaff guards add operational work | Keep paused; offers no proven availability advantage |
| C: historical bootstrap + incremental updates | 8 independently corroborated matches / 25,265; 0 permission-cleared imports | Tiny measured storage; identity/source-era/licensing complexity; incremental collection still blocked | Does not deliver significant full-catalog coverage; NO-GO production bootstrap |

With 15-second spacing, the zero-latency mathematical ceiling is **240 attempts/
hour**; using measured mean latency yields about **232 attempts/hour while access
lasts**. Neither is sustainable throughput. Actual measurement produced 2 accepted
observations in 93.237 seconds and then stopped. **Dependable unattended throughput
is unestablished**; no daily/monthly harvest estimate is defensible from this run.
At the spacing floor alone, 25,265 page requests would take over 105 hours before
latency, blocks or review; no such crawl is proposed.

This repository is public. [GitHub's billing rules](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
provide free standard hosted-runner compute for public repositories. This run used
approximately two minutes if rounded upward; private GitHub Free would instead
share a 2,000-minute allowance. Artifact storage remains separately governed by
the account plan; the sanitized artifact is 1,188 bytes and expires after 14 days.
No paid runner/service or billing setting was activated.

**Recommendation:** retain existing last-good cache/fallback behavior and external
Goodreads links; keep the Windows worker paused and avoid a new production pipeline.
If content permission is established, opportunistic small manual Actions batches
with verified identities are simpler than another hosting service or laptop daemon.
Historical records must remain a separate, visibly historical source and only be
replaced by a complete current average/count pair for the same proven work.
Automatic mobile display of newly imported historical data is **not implemented**
because neither meaningful coverage nor reuse eligibility was established.

## Acceptance gates and validation

| Production collection gate | Finding |
| --- | --- |
| Meaningful page availability | 50% accessible on 6 attempts, then blocked; insufficient |
| Consistent average/count extraction | 2 accepted pages; Apollo/JSON-LD agreement proven locally and on runner |
| Correct identity | Strict checks rejected changed edition; broader precision unmeasured |
| Repeated collection stable | Earlier small success did not generalize; another-day comparison unmeasured |
| Free resource fit | Small public standard-runner experiment fits; no scaling claim |
| Block handling | Three-block circuit stopped all further testing; no retries/bypass |
| Significant verified historical coverage | 8/25,265 = 0.0317%; fails |
| Source reuse permission | Unresolved; fails production import/display gate |

Focused offline tests cover live average/count agreement, rating-versus-review
counts, exact identity/ISBN, scope, original ISBN preservation, XML distribution
validation, source/work mappings, duplicate/conflicting editions, quarantined
idempotency/conflicts, interrupted resume, changed target checkpoints, PAUSE/STOP,
15-second spacing and durable three-block stopping. Minimal repository CI includes
these research tests alongside the existing checks. Lint and typecheck pass.
No mobile/emulator, production import or sustained background acceptance is claimed.

**GO:** reproducible bounded research and offline quarantined validation.
**NO-GO:** unattended collection, large crawler, historical production import or
new historical rating display. No further Goodreads requests are warranted in
this phase after the measured access circuit trip.
