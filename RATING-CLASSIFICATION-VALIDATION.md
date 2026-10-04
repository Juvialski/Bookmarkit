# Rating and classification acceptance — 2026-10-04

Baseline: `fbabec668baef94433fd9e6ce6fe23419c57e48a` from refreshed `origin/main`.

## Changed files

- App/catalog import: `App.tsx`; replace `assets/catalog-v1.db` with `assets/catalog-v2.db`.
- Model and result UI: `src/models/book.ts`, `src/screens/BookResultScreen.tsx`.
- Merge and adapters: `src/utils/classification.ts`, `src/services/bookLookup.ts`, `src/services/localCatalog.ts`, `src/services/providers/{hardcover,openLibrary,shared}.ts`.
- Catalog inputs/generation: `catalog/{curated,source}.json`, `scripts/{catalog.py,add-validation-seeds.py,test_catalog.py}`.
- Proxy: `server/src/hardcover.mjs`, `server/tests/hardcover.test.mjs`, `server/README.md`.
- Mobile tests: `tests/{classification,localCatalog}.test.ts`.
- Documentation: `README.md`, this acceptance record. CI configuration is unchanged.

## Behavior

One visible score: valid Hardcover, online Open Library, stored Open Library, then **Not rated**. Scores are never averaged. Finite positive scores up to five are accepted; absent/invalid counts are omitted. Optional provider failures never add result-screen warnings or empty cards.

Classification accepts only explicit numbered series or affirmative curated standalone evidence. Hardcover structured data precedes Open Library when they agree or the other source is unknown. Matching names ignore casing/repeated whitespace and positions compare numerically; conflicting names, positions or series-versus-standalone evidence yield unknown. Missing metadata never means standalone. Fractional positive positions are supported; malformed/nonfinite positions are rejected. No title, subject or prose inference occurs.

The catalog supplements online classification and supplies stored ratings only when online scores are missing. `classificationSource`, `classificationConfidence` and rating `stored` provenance remain internal. Catalog read failures cannot discard online success. Stored-rating supplementation and offline results use the short 30-second session TTL.

## Hardcover boundary

No `HARDCOVER_API_TOKEN` was present in the process environment; no server `.env` existed. No authenticated live Hardcover success is claimed. Mocked backend contracts cover exact edition ISBN, parent work rating/count, title, author contributions, featured series, fractional positions, outages, bounded response bodies, cache and concurrency.

The current official [Books schema](https://raw.githubusercontent.com/hardcoverapp/hardcover-docs/main/src/content/docs/api/GraphQL/Schemas/Books.mdx) and [Book Series schema](https://raw.githubusercontent.com/hardcoverapp/hardcover-docs/main/src/content/docs/api/GraphQL/Schemas/BookSeries.mdx) confirm `featured_book_series`, `position`, `compilation` and the series relationship. The fixed query remains unchanged. Absence of that relation is unknown; no explicit standalone field was assumed. Mobile proxy deadline: 2.5 seconds; upstream deadline: 2 seconds. Providers run concurrently without retries or a racing state machine.

## Catalog and authoritative annotations

`catalog/curated.json` contains five exact-ISBN annotations. Every entry requires an HTTPS source and evidence. Publisher pages establish Stormlight books 1 and 2. Author pages explicitly identify Warbreaker, Tress and Yumi as standalone. This describes standalone narratives, not disconnection from the shared Cosmere setting or a promise that no sequel will ever exist.

Sources: [Warbreaker author introduction](https://www.brandonsanderson.com/pages/hello-my-names-brandon), [Tress/Yumi author descriptions](https://www.brandonsanderson.com/pages/standalones-cosmere), [Words of Radiance publisher page](https://us.macmillan.com/books/9780765326362/wordsofradiance/), and the existing Way of Kings publisher source in the input file.

Three exact Open Library edition/work/rating snapshots were added. No broad dataset refresh was performed. `python scripts/catalog.py` builds without network access; `scripts/add-validation-seeds.py` is an explicit manual network refresh helper, outside CI. The regular full refresh includes all ten seed editions. Annotation lookup occurs per ISBN and cannot accidentally propagate across a work's other ISBNs.

Result: **7,919 ISBNs / 1,109 works / 884,736 SQLite bytes / 197,379 gzip bytes**. Gzip is a measurement only; raw SQLite is bundled. `catalog-v2.db` has classification provenance and schema metadata. Both asset and installed database names changed to ensure existing installations import the new copy. No covers, Hardcover scores or Goodreads data are bundled.

## Android emulator sample results

Pixel 9 Pro, Android 17/API 37, x86_64. The source bundle and a locally built standalone release APK were exercised. Initial three online samples were tested through Expo Go; the later samples and offline/reconnection checks used the release app. No physical-device or iOS Simulator acceptance is claimed. The local Android build uses the generated debug signing key, not store signing.

| ISBN | Displayed title | Type / series | Score | Provider / count | Goodreads browser result |
| --- | --- | --- | --- | --- | --- |
| 9780765326355 | The Way of Kings | SERIES — The Stormlight Archive · Book 1 | 4.5 | Open Library / 166 | ISBN search loaded; matching book |
| 9780765320308 | Warbreaker | STANDALONE | 4.3 | Open Library / 23 | ISBN search loaded; matching book |
| 9780140328721 | Fantastic Mr. Fox | TYPE UNKNOWN | 4.0 | Open Library / 121 | ISBN search loaded; matching book |
| 9780765326362 | Words of Radiance | SERIES — The Stormlight Archive · Book 2 | 4.7 | Open Library / 98 | ISBN search loaded; matching book |
| 9781250899651 | Tress of the Emerald Sea | STANDALONE | 4.6 | Open Library / 10 | ISBN search loaded; matching book |
| 9781250899699 | Yumi and the Nightmare Painter | STANDALONE | 4.8 | Open Library / 12 | ISBN search loaded; matching book |
| 9780140430776 | American notes for general circulation | TYPE UNKNOWN | Not rated | None | ISBN search page loaded |
| 9799999999907 | No identified book (checksum-valid test ISBN) | No result screen | None | None | No result-screen button; scanner stayed usable |
| 9780765326355, mock success | The Way of Kings | SERIES — The Stormlight Archive · Book 1 | 4.6 | Hardcover / 12,345, fictional fixture | Same ISBN-only action |
| 9780765326355, mock failure | The Way of Kings | SERIES — The Stormlight Archive · Book 1 | 4.5 | Open Library / 166 | Same ISBN-only action |

Chrome opened from the result-screen button. Its URL included the scanned ISBN and `search_type=books`; the loaded search pages were viewed without account/login automation. Search is retained as the proven route: it is not claimed to auto-redirect directly to a book detail page. The app only invokes `Linking.openURL`; no Goodreads fetch, HTML parser, scraper or numerical-score ingestion exists. Browser inspection was acceptance observation, not catalog ingestion.

## Offline and reconnection

Disabled Wi-Fi and mobile data and enabled airplane mode. After transitions settled, Android reported `Active default network: none`, `airplane_mode_on=1`, `wifi_on=0`. The standalone app remained running with its native SQLite module and required no Metro connection.

The Way of Kings retained SERIES/Book 1/4.5/166; Warbreaker retained STANDALONE/4.3/23; Fantastic Mr. Fox retained TYPE UNKNOWN/4.0/121. Covers used the offline placeholder. Goodreads remained visible; opening naturally depends on connectivity. Scan Another returned to the scanner for each sample. No provider error or technical warning appeared on result screens. The uncatalogued checksum fixture produced a recoverable scanner error, without inventing a book or rating.

Restored airplane mode off, Wi-Fi and mobile data. After more than 30 seconds, rescanning The Way of Kings in the same release-app session loaded online metadata and a cover again, replacing its coverless offline result. Network was restored at the end of testing. No persistent network cache exists.

## Basic lookup timing

Coarse tap-to-observed-result measurements include a one-second polling interval and Android UI hierarchy dump overhead. They are upper bounds for perceived lookup, not API latency or a benchmark suite.

| Scenario | Observed seconds |
| --- | --- |
| Open Library only, Way of Kings, initial lookup | 6.35 |
| Open Library only, Warbreaker / Fantastic Mr. Fox | 3.78 / 3.96 |
| Hardcover mock success + Open Library | 4.19 |
| Hardcover mock failure + Open Library, confirmed Expo Go run | 6.26 |
| Completely offline catalog lookup, three required books | 3.01–3.02 |
| Reconnected lookup after offline TTL, Way of Kings | 6.22 |

These samples include variable external Open Library latency. The focused fake-clock test independently confirms that an unresponsive optional proxy reaches its 2.5-second deadline and preserves an already available Open Library result. Open Library retains its existing ten-second per-request deadline; its sequential edition/details/author stages can take approximately 30 seconds in the worst case. Further latency tuning needs more evidence rather than inference from these coarse samples.

## Automated checks and remaining boundary

35 mobile tests, 20 backend mocked tests, three catalog tests, backend syntax checks, TypeScript, Expo lint, Expo dependency check and Expo Doctor (21/21) pass. Android and iOS exports pass. Normal CI retains its existing short mocked/local checks; no emulator, native build, EAS, live provider calls or dataset downloads were added.

Source inspection and request-capture tests confirm no Google runtime provider and no app-side Goodreads requests. Local mock configuration is ignored and removed after testing; no token was supplied or committed.

Recommended next phase: configure a legitimate server-only Hardcover token and validate several live ISBNs against the existing schema/normalization contract. Keep publishing, physical-device testing and new product features separately scoped. Small-screen/software-keyboard, iOS Simulator and physical camera behavior remain outside this emulator acceptance.
