# Hardcover proxy

Dependency-free Node.js 22.13+ HTTP service. No database, accounts, generic GraphQL endpoint or mobile credential. Production starts only `src/index.mjs`; the mock helper is separate.

```sh
cd server
npm install
cp .env.example .env
# Set HARDCOVER_API_TOKEN in server/.env, never in the mobile environment.
npm start
npm test
npm run check
```

`GET /health` returns `{ "status": "ok" }` even without a token; it verifies HTTP process health, not upstream authorization. `GET /api/books/:isbn/hardcover` requires a checksum-valid 978/979 ISBN-13 (digits only). A hit returns `found`, `isbn`, edition title, authors, optional HTTPS cover, optional rating/count, optional numbered series, book ID and optional Hardcover URL. Missing fields are omitted. A miss returns `{ "found": false }`. Invalid ISBN: 400. Missing token/capacity: 503. Upstream/auth/malformed response: 502. Timeout: 504. All failure bodies are generic; no raw GraphQL errors, credentials or stack traces are logged or returned. No CORS configuration is needed for native clients.

Two-second upstream deadline includes response-body reading. Maximum body: 64 KiB. Fixed query, maximum two matching editions and eight contributors per book. Different work IDs for the same ISBN are rejected rather than guessed. Same-ISBN requests coalesce, at most four unique upstream calls run concurrently, and a 256-entry memory cache holds hits for six hours and misses for five minutes. Failures are never cached. Cache resets on restart; multiple service instances have independent caches.

## Official schema checked 2026-10-04

Read the current official [documentation source](https://github.com/hardcoverapp/hardcover-docs/tree/52e6afc0b90a839669c9fa56591a0ed64317b046/src/content/docs/api), including `Getting-Started.mdx`, `guides/GettingBookDetails.mdx`, and `GraphQL/Schemas/{Editions,Books,Contributions,Images,BookSeries,Series}.mdx`. This is schema/document inspection, not a live authenticated query. The API is beta; live validation remains necessary after token configuration. [API setup](https://docs.hardcover.app/api/getting-started/) describes obtaining a private token and scopes. Use catalog-read permissions appropriate to this read-only query; no user mutations are needed.

Query sent to `POST https://api.hardcover.app/v1/graphql` with a server-only `Authorization: Bearer ...` header:

```graphql
query BookByIsbn($isbn: String!) {
  editions(where: {isbn_13: {_eq: $isbn}}, order_by: {id: asc}, limit: 2) {
    isbn_13 title image { url }
    book {
      id title slug rating ratings_count image { url }
      contributions(limit: 8, order_by: {id: asc}) { contribution author { name } }
      featured_book_series { compilation position series { name } }
    }
  }
}
```

ISBN belongs to an edition; rating/count belong to its parent work. Edition title/cover precede work title/cover. Only Author or unlabelled primary contributions become authors; narrator/editor/etc. are excluded. Numeric rating strings are normalized without accepting malformed values; ratings must be positive and at most five. Counts must be nonnegative safe integers; count zero suppresses a rating. Missing count remains unknown. Only a non-compilation featured series with a positive numeric position becomes numbered series. Missing series never implies standalone. Slugs containing only lowercase letters, digits and hyphens form `https://hardcover.app/books/:slug`; otherwise omit URL.

## Local emulator mock

```sh
node server/scripts/mock.mjs
```

Run from the repository root. Port 3001, fixture ISBN `9780765326355`, **fictional** Hardcover 4.6 / 12,345 ratings. Other ISBNs miss. Optional first argument is a local mode-file path containing `success` or `failure`; the latter simulates upstream 503. No legitimate token or live Hardcover API is used. The production start command never loads this helper.

Set mobile `EXPO_PUBLIC_BOOK_API_BASE_URL=http://10.0.2.2:3001` for Android Emulator. Rebuild after changing between local HTTP and HTTPS: the CNG plugin configures a domain-specific Android HTTP exception for the selected local host. Never enable global cleartext or iOS arbitrary loads. For local iOS testing use an HTTPS endpoint.

## Later Render setup

No deployment was attempted because `HARDCOVER_API_TOKEN` was unavailable. Deploy a Node web service from this repository with root directory `server`, build command `npm ci`, start command `npm start`, and health path `/health`. Set `HARDCOVER_API_TOKEN` securely in Render, `NODE_VERSION=22.16.0` (or a supported newer Node 22+), and let Render supply `PORT`. No disk/database/Redis. Set mobile `EXPO_PUBLIC_BOOK_API_BASE_URL` to the resulting HTTPS URL and rebuild/export. Verify both `/health` and `/api/books/9780765326355/hardcover` with the legitimate token before claiming live verification. `/health` alone does not prove the token works.
