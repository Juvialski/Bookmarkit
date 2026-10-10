# Book catalog operations

Existing project: `xxijxuekfsxuzhnujqem`, Singapore. The central database and Storage snapshot were deployed during V2. Public readers have SELECT only; ingestion, Gemini usage and circuit records are private. Every public table has RLS. Trusted service-role operations perform imports; credentials never enter the APK.

The downloaded SQLite snapshot contains **25,265 distinct works, 25,265 linked editions and 26,464 checksum-valid ISBN-13s**. ISBN-10 equivalents are derived only for the 978 range. **1,703 works have Open Library ratings; 4,160 works have resolved author names**, corresponding to 3,987 distinct referenced authors. Unresolved authors stay empty. Missing series remains unknown.

`catalog/packages/expanded.db` is an actual generated SQLite file, **31,838,208 bytes**, SHA-256 `ba7b45949586e03c9be2f747bd297053dfd84b3b464d2142e24b3602592c9b70`. It is not imported by Metro or bundled in the APK. The original `assets/catalog-v3.db` remains the immediate fallback. The package manifest and local validation report are committed beside the expanded snapshot.

## Ingestion

Run `python scripts/expanded_catalog.py --works 25000`, then `python scripts/validate_expanded.py`.

This streams the official Open Library monthly editions dump until a bounded work target is checkpointed, resolves referenced authors from the authors dump with a five-minute resource bound, and aggregates the official ratings dump. It makes no per-book API calls. A work is accepted only with one explicit work reference and a real ISBN checksum. Multiple ISBNs link to the exact selected edition. Duplicate ISBN claims are resolved conservatively to one catalog record; four selected work records had no remaining unique ISBN and were excluded from the package. No unrelated ratings are averaged.

`dist/catalog/checkpoint.sqlite` preserves accepted edition records across interruption. Month changes invalidate the edition checkpoint. Resolved author names are checkpointed; an interrupted/bounded author pass preserves only names actually seen. Ratings are recomputed from their dump. The current snapshot is a bounded sample of the dump, not a popularity-ranked or comprehensive catalog. It does not pretend all 25,265 works have authors, ratings or series metadata.

Source URLs and generated month are in the manifest. Open Library publishes dumps monthly; metadata is reusable under its documented data policies. Gemini-grounded and Google Books results are excluded from downloadable and central snapshots.

## Publication

`python scripts/catalog_publish.py` validates checksums/integrity/counts, upserts works/authors/editions/ISBNs/ratings, uploads an immutable version/hash path to the existing `book-catalogs` bucket, then publishes the manifest and ingestion record. Set `SUPABASE_SERVICE_ROLE_KEY` only in the trusted backend/job environment. An unchanged published checksum skips duplicate imports/publication.

The one-time `publish-snapshot` Edge Function accepts exactly the committed snapshot's byte count and SHA-256. It cannot publish arbitrary supplied files or change other catalog content. It uses the server-injected service key internally. Reproducible monthly publication uses the service-role job, not this bootstrap endpoint.

Monthly GitHub Actions runs on the fifth day at 04:17 UTC, with a 30-minute bound, restored checkpoint cache and validated output artifacts. Configure the one repository secret **`BOOKMARKIT_SUPABASE_SERVICE_ROLE_KEY`** to enable automatic publication. This secret is currently absent/unverified; the scheduler and artifacts are implemented, but unattended live refresh is not claimed. No continuously running server is required.

## Mobile installation

The Offline Books screen gets actual counts, size and hash from public manifests. Download is optional. A `.part` file is verified with SHA-256, SQLite integrity, schema version and actual work/ISBN counts before moving to a content-addressed filename. The selected catalog pointer changes through a single SQLite settings write after validation. The previous installed version remains selected during download/cancellation; broken expanded files automatically fall back to the bundled database. Retry replaces corrupt unselected remnants. Deletion clears the pointer before removing the app-owned expanded file.

## Validation

`python scripts/validate_expanded.py catalog/packages` checks real ISBN checksums, work/edition links, counts, integrity, package checksum and conservative standalone classification. Local measurements in `validation.json` are SQLite timings on this Windows host: median about 0.38 ms and p95 about 1.12 ms for a warm real ISBN hit. They are not native scan-to-result timings.

Official references: [Open Library dumps](https://openlibrary.org/developers/dumps), [Open Library licensing](https://openlibrary.org/developers/licensing), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage upload](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
