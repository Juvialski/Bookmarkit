# Goodreads scraping feasibility — 11 October 2026

**PARTIALLY WORKING extraction; dependable unattended Windows collection is not
established.** Direct public HTML contains the required data, but Windows access
was inconsistent. GitHub Actions obtained three verified results across four
books. The most promising historical bootstrap is goodbooks-10k's original XML,
subject to licensing, identity review and historical/population labeling.

Base: merged PR #13, `origin/main` at `0fd2f6a754dc3778aa466406925f92653dfdd4ab`.
Read `GOODREADS.md`, its evidence files and `goodreads_worker.py` first. New raw
observations remain under ignored `dist/research/` in the feasibility worktree.
No production data, Supabase state, collector circuit, Gemini configuration,
APK/mobile code or scheduled background task was changed. Chrome was untouched.

## Methods and measured outcomes

**25 new Goodreads HTTP requests:** 11 book documents, 9 autocomplete requests,
5 robots checks. No retries, login, proxy rotation, CAPTCHA solving, fingerprint
spoofing or challenge execution. Robots was checked; disallowed search/work/review
routes were not used. Book probes used at least 15 seconds spacing. Two lightweight
Windows HTTP processes briefly overlapped; frequency was not controlled enough
to isolate rate limiting. The previous pilot is excluded from this request budget.

| Method/environment | Books attempted | HTTP 200 responses | Average/count data | Usable verified matches | Access blocks | Verdict |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| A: Windows anonymous urllib, exact book pages | 6 | 3 (50%) | Both fields on 3 pages | 2 (33.3%) | 3 (50%) | PARTIALLY WORKING |
| B: Windows autocomplete, title + independently checked author | 8 | 8 (100%) | Candidate ratings/counts; not accepted target scores | 0; 4 strict title/author candidates | 0 | PARTIALLY WORKING discovery; BLOCKED verified collector |
| B: CLI v0.3.1 `suggest`, exact Hunger Games ISBN | 1 | 1 (100%) | Both fields on correct candidate | 0 import-ready | 0 | PARTIALLY WORKING discovery |
| C: isolated Windows headless Chromium | 1 | 0 | None | 0 | 1 (100%) | BLOCKED |
| A: public GitHub Actions urllib comparison | 4 | 4 (100%) | 3 pairs extracted/accepted; fourth rejected before rating extraction | 3 (75%) | 0 | PARTIALLY WORKING |
| D: original goodbooks XML, 20-target offline search | 20 | 12 historical records | Both fields on 12 records | 7 exact catalog ISBN metadata matches; 0 production-ready ratings | N/A | PARTIALLY WORKING historical bootstrap |

The first three Windows pages were Hunger Games, Way of Kings and Warbreaker.
The next three (Harry Potter, Mockingbird, 1984) returned **HTTP 202 challenges**,
and book-page testing stopped. Warbreaker returned an ebook without ISBN, not
catalog ISBN `9780765320308`; its 4.29 / 307,386 was rejected for that edition.
Runner Mockingbird also returned a different ISBN and was rejected. HTTP success
alone therefore overstates usable coverage.

Autocomplete returned strict title/author candidates for Piranesi, Tress, Yumi
and Babel. Eight responses contain numerical fields, including zero/unrated and
wrong-book candidates. These fields do not establish correct target scores. No
ISBN was published and the rating population was not proven; none was imported.

### Accepted live observations

| Book / author | Exact URL | ISBN | Goodreads work | Average | Ratings |
| --- | --- | --- | --- | ---: | ---: |
| Hunger Games / Suzanne Collins | [2767052](https://www.goodreads.com/book/show/2767052-the-hunger-games) | 9780439023481 | 2792775 | 4.36 | 10,312,003 |
| Way of Kings / Brandon Sanderson | [7235533](https://www.goodreads.com/book/show/7235533-the-way-of-kings) | 9780765326355 | 8134945 | 4.66 | 731,329 |
| Harry Potter and the Sorcerer's Stone / J.K. Rowling | [3](https://www.goodreads.com/book/show/3.Harry_Potter_and_the_Sorcerer_s_Stone) | 9780439554930 | 4640799 | 4.47 | 11,862,678 |

Hunger Games and Way of Kings were verified on Windows and runners; Harry Potter
only on a runner. Runner observations: **08:10:34–08:13:03 Manila**, 11 October.
Each accepted result has exact ISBN, title and primary-author agreement, the expected
Goodreads work ID, and matching JSON-LD `aggregateRating.ratingValue/ratingCount`
and resolved Apollo **Work.stats**. Rating scope is **work**, not edition. Review
count is separate. Series placements are available in the same Apollo payload
(Hunger Games #1, Stormlight #1, Harry Potter #1). Server HTML is sufficient.

Current independent Open Library ISBN endpoints linked accepted editions to their
expected catalog works; work authors were fetched separately. Harry Potter's US
title/ISBN was checked as an alternate edition of OL82563W, not through title
similarity alone. Observation time does not prove Goodreads/CDN freshness.
CLI autocomplete returned Hunger Games 4.36 / 10,312,014, versus HTML 10,312,003:
close agreement for one book cannot establish population equivalence or freshness.

## Twenty-book control set

Selected from the existing 1,115-row `catalog/source.json`. Current Open Library
work/author checks covered all 20; ISBN endpoint checks confirmed **18/20** work
links. The two conflicting links are quarantined, with no catalog repair in this
phase. Historical exact matches mean XML ISBN occurs in the catalog ISBN list;
they still require aggregate-population review before import.

| Target / independently checked authors | Catalog work | Independently checked ISBN | Outcome |
| --- | --- | --- | --- |
| The Hunger Games / Suzanne Collins | OL5735363W | 9780439023481 | Windows + runner verified; historical exact ISBN |
| Harry Potter and the Philosopher's Stone / J. K. Rowling | OL82563W | 9780195798586 | Windows blocked; alternate US edition runner verified; historical candidate |
| The Way of Kings / Brandon Sanderson | OL15358691W | 9780765326355 | Windows + runner verified; historical exact ISBN |
| Warbreaker / Brandon Sanderson | OL5738149W | 9780765320308 | Windows edition rejected (no ISBN); historical candidate |
| To Kill a Mockingbird / Harper Lee | OL3140822W | 9780061120084 | Windows blocked; runner edition rejected; historical exact ISBN |
| 1984 / George Orwell | OL1168083W | 9780451524935 | Windows blocked; historical exact ISBN |
| Pride and Prejudice / Jane Austen | OL66554W | 9780003700756 | Book page untested after circuit stop; historical candidate |
| Dune / Frank Herbert | OL893414W | 9780143111580 | Book page untested after circuit stop; historical exact ISBN |
| It / Stephen King | OL81613W | 9780142427873 | Book page untested after circuit stop; historical exact ISBN |
| The Road / Cormac McCarthy | OL40873W | 9780307265432 | Book page untested after circuit stop; historical exact ISBN |
| Emma / Jane Austen | OL66513W | 9780004244136 | Book page untested after circuit stop; historical candidate |
| Piranesi / Susanna Clarke | OL20893680W | 9781432886578 | Autocomplete candidate only; no historical hit |
| Tress of the Emerald Sea / Brandon Sanderson | OL28687656W | 9781250899651 | Autocomplete candidate only; no historical hit |
| Yumi and the Nightmare Painter / Brandon Sanderson | OL31146657W | 9781250899699 | Autocomplete candidate only; no historical hit |
| Control Your Mind and Master Your Feelings / Eric Robertson | OL25312237W | 9781691706631: conflicting /works/OL37998610W | Autocomplete unresolved; quarantine; no historical hit |
| I Don't Love You Anymore / Rithvik Singh | OL38382569W | 9780143469131 | Autocomplete unresolved; no historical hit |
| Wild Animal Coloring Book / Katty Green | OL30585610W | 9798553291365 | Autocomplete unresolved; simulated missing ISBN; no historical hit |
| Marc Chagall / Marc Chagall, Evgenija Petrova, Aleksandra Shatskikh | OL4875453W | 9780847806249: conflicting /works/OL8630090W | Autocomplete unresolved; simulated missing ISBN; quarantine; no historical hit |
| Babel / R. F. Kuang, Michel Pagel | OL26443093W | 9780008501815 | Autocomplete candidate only; no historical hit |
| Fantastic Mr. Fox / Roald Dahl | OL45804W | 9780140328721 | Book page untested after circuit stop; historical candidate |

No source catalog rows are naturally ISBN-less. Wild Animal Coloring Book and
Marc Chagall therefore model missing ISBN input by withholding it from matching:
this is a **synthetic input condition**, not a claim that those books lack ISBNs.
It, Emma, The Road and Marc Chagall exercise ambiguous titles; modern and obscure
books broaden coverage. All 20 were investigated, but not requested by every live
method. Untested pages after the circuit stopped are not counted as failures.

## CLI and browser audit

Latest CLI main still equals the previous audited
[`05af9312`](https://github.com/tamnd/goodread-cli/tree/05af9312a0816521e30481c4b5eff7c8adf9c63d).
`cli/cmd_lookup.go` first checks its store, then calls public
`/book/auto_complete?format=json&q=...`, then `/book/show/<id>` for candidates.
The earlier successful ISBN lookup's stored Apollo record proves a book page
was parsed. The old pilot retains per-book blocks, not request traces, so it
cannot identify the exact failing endpoint for its Hobbit, Order of the Phoenix
and Shining attempts. This run separately tested discovery and book-page access.

`extract_book.go::workFrom` reads `Work.stats`. `model_book.go::BookFrom` and
`WorkFrom` share `statsFrom`; the README's edition-population claim remains
unsupported. `extract_suggest.go` copies `avgRating/ratingsCount` without proving
population or publishing ISBN. Autocomplete can discover exact URLs/work IDs,
but cannot replace the current proven-population import requirements.
Robots allows ordinary book pages and autocomplete for the identified research
client; general `/work` and `/search` routes were not tested or overridden.

The browser used existing Playwright Chromium in a fresh anonymous context,
headless mode, `--disable-gpu`, JavaScript disabled and a one-document network
budget. Subrequests were aborted; HTTP 202 stopped the test before rendering or
challenge processing. **Hydrated rendering and logged-in Chrome remain untested**.
No profile/cookies were inspected or exported, no existing tabs were closed,
and no foreground interaction or Hubstaff control occurred.

Hunger Games returned Windows HTTP 200 initially, headless HTTP 202 later and
runner HTTP 200. This shows variable availability; it does not isolate network,
IP, timing, caching, browser or authentication as the cause. Successful extraction
needed neither login nor a browser. Changing parsers cannot remove access controls.

## Historical alternatives and initial coverage

| Dataset | Coverage / date | Required fields and limitations | Publisher terms | Verdict |
| --- | --- | --- | --- | --- |
| [UCSD Book Graph](https://sites.google.com/eng.ucsd.edu/ucsdbookgraph/home), [book schema](https://sites.google.com/eng.ucsd.edu/ucsdbookgraph/books) | 2,360,655 books, 1,521,962 works; collected late 2017; corrections May 2019 | ISBN, book/work/author/series IDs, URL, average/count; separate author/series joins; sample lacks record collection time | Academic use only, no redistribution or commercial use | BLOCKED for a shipped catalog without permission; no download |
| [goodbooks-10k](https://github.com/zygmuntz/goodbooks-10k/tree/6dd165b555a7b47b2dd36743a425776e641ff50c), original XML | 10,000 popular books; 2017 snapshot era; CSV last changed 13 September 2017 | Exact ISBN, author names, book/work IDs, URL, average, separate book/work counts; no per-record collection time; series often title text | [Publisher declares CC BY-SA 4.0](https://github.com/zygmuntz/goodbooks-10k/blob/6dd165b555a7b47b2dd36743a425776e641ff50c/LICENSE) | PARTIALLY WORKING, most promising publisher-licensed bootstrap candidate |

Downloaded only metadata CSV and the **55,777,086-byte XML ZIP**, not review/user
interaction datasets. Read original XML for the 12 title-plus-author candidates.
Seven exact catalog ISBN matches: Hunger Games, Way of Kings, Mockingbird, 1984,
Dune, It and The Road. Thus **7/20 (35%) exact historical metadata coverage** and
**12/20 (60%) candidate coverage**, not full-catalog coverage or import acceptance.
Source ceiling is 10,000 popular books; obscure and post-2017 titles remain gaps.

CSV ISBN13 is rounded scientific notation (e.g. `9.78043902348e+12`), unsafe for
exact identity; XML preserves `9780439023481`. CSV and XML Hunger Games work counts
also differ (4,942,365 vs 4,946,741); never mix their fields. XML book and work
rating counts differ, and the average's population needs proof before pairing it
with either population in current storage. Existing ingestion requires proven
population and cannot ingest these as live Apollo summaries. Use snapshot era
`2017`, exact record time `unknown`, source hash and historical status separately;
download date is not source date. Publisher licensing does not independently
establish Goodreads' underlying content permissions: review distribution
obligations before shipping derived data.

SHA-256: CSV `4d21d0e0433128657c752e3a3d0405ac0ec11675d6c70c64cb0abf4ab1acb76a`;
XML ZIP `f9724dddfbd4d744e97977c4d631684b2aa238739893749ffc66b7cb8f5f3a66`.

## Resource evidence and reproducibility

Windows accepted document latency averaged **2.667 s**, excluding 15-second
spacing. A temporary hidden **Idle-priority** HTTP probe stopped after three blocks:
mean attempt **0.065 s**, **35.95 MiB peak working set**, **0.0312 s total process
CPU**, about 45 seconds of spacing. Initial successful requests used 0.0625 / 0.0781
s CPU; their memory measurement failed and is unavailable. No browser/GPU was
involved in HTTP probes. Runner accepted latency averaged **1.277 s**, mean
**0.0234 s Python CPU**; memory unavailable. Browser elapsed 8.904 s including
startup; Python CPU 0.0469 s excludes Chromium. Browser memory, child CPU and
actual GPU activity were not measured.

No sustained gaming/Hubstaff interference, battery transitions or shutdown/resume
acceptance was tested. The existing worker's SQLite queue/checkpoints, AC/idle/
resource/game/Hubstaff guards and durable block circuit remain intact and inactive.
The research POC is a **manual bounded probe**, not an unattended scheduler:
local result checkpoints, one-second PAUSE/STOP polling between requests, no
automatic resume deduplication or battery/resource guards. An in-flight request
can take up to 25 seconds to finish. Do not run it automatically.

```powershell
# Save a JSON array under ignored dist/research/targets.json:
# [{"url":"https://www.goodreads.com/book/show/2767052","title":"The Hunger Games",
#   "authors":["Suzanne Collins"],"isbns":["9780439023481"],"goodreads_work_id":"2792775"}]
python scripts/research_goodreads.py --targets dist/research/targets.json --output dist/research/results.json --limit 1
python -m unittest discover -s scripts -p test_research_goodreads.py
```

The POC saves only allowlisted book/rating fields in ignored `dist/`, checks
robots, uses no credentials/retries and stops after three consecutive blocks.
Missing-ISBN results explicitly require identity/work review. No raw HTML,
session information, production upload or scheduler is included.

**Recommendation:** keep the Windows collector paused. Next bounded phase should
review goodbooks XML licensing and population, then reconcile exact ISBNs against
the full catalog offline, with historical data separated from live summaries.
A later authorized runner pilot could test broader coverage and repeated-day
availability with a conservative circuit. These results support an opportunistic
direct-HTML parser, not reliable free unattended Windows collection.

Public evidence: [first runner book](https://github.com/Juvialski/Bookmarkit/actions/runs/38097511271),
[three-book comparison](https://github.com/Juvialski/Bookmarkit/actions/runs/38097620424).
The temporary PR-only probe workflow was removed after these two runs; no recurring
research automation remains. Workflow success means the probe completed, not that
every book matched. Five offline Python parser/control checks passed; lint and
typecheck passed. No Android or production acceptance is claimed.
