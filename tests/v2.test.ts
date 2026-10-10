import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleBooksSearch } from '../src/services/providers/googleBooks';
import { validateManifest } from '../src/services/catalogManifest';
import { createProgressiveLookup } from '../src/services/progressiveLookup';
import { ProviderBook } from '../src/models/book';
import { groundingAvailable } from '../src/services/groundedSearch';
test('native capability check does not depend on AbortSignal.timeout', async context => {
  context.mock.method(AbortSignal, 'timeout', () => { assert.fail('Unsupported native helper invoked'); });
  context.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'disabled' }));
  assert.equal(await groundingAvailable(), false);
});
test('fast rated edition returns while a slow provider finishes; enrichment reuses requests', async () => {
  let finish!: (book: ProviderBook) => void, calls = 0;
  const book: ProviderBook = { isbn: '9780765320308', title: 'Warbreaker', authors: ['Brandon Sanderson'], seriesStatus: 'unknown', rating: { provider: 'Open Library', average: 4.4 } };
  const slow = new Promise<ProviderBook>(resolve => { finish = resolve; });
  const lookup = createProgressiveLookup(async () => null, [async () => { calls++; return book; }, async () => { calls++; return slow; }]);
  const first = await lookup.lookup(book.isbn!); assert.equal(first.title, 'Warbreaker'); assert.equal(calls, 2);
  finish({ ...book, rating: { provider: 'Hardcover', average: 4.5 } });
  assert.equal((await lookup.enrich(first)).ratings.length, 2); assert.equal(calls, 2);
});
test('Google Books ISBN results must include the exact edition identifier', async () => {
  const fetcher = (async () => Response.json({ items: [
    { volumeInfo: { title: 'Wrong book', industryIdentifiers: [{ identifier: '9780140328721' }], averageRating: 5 } },
    { volumeInfo: { title: 'Warbreaker', authors: ['Brandon Sanderson'], industryIdentifiers: [{ identifier: '9780765320308' }], averageRating: 4.4, ratingsCount: 20 } }
  ] })) as typeof fetch;
  const books = await googleBooksSearch({ isbn: '9780765320308' }, fetcher);
  assert.equal(books.length, 1); assert.equal(books[0].title, 'Warbreaker'); assert.equal(books[0].ratings[0].provider, 'Google Books'); assert.equal(books[0].seriesStatus, 'unknown');
});
test('download manifests reject unsafe origin, size, checksum and counts', () => {
  const valid = { version: '2026-10', schema: 'v3', works: 25000, isbns: 30000, bytes: 10000000, sha256: 'a'.repeat(64), url: 'https://xxijxuekfsxuzhnujqem.supabase.co/storage/v1/object/public/book-catalogs/2026-10/catalog.db' };
  assert.equal(validateManifest(valid).works, 25000);
  for (const invalid of [{ url: 'https://evil.test/file' }, { bytes: 40000001 }, { sha256: 'bad' }, { works: -1 }, { isbns: 1 }, { version: '../bad' }]) assert.throws(() => validateManifest({ ...valid, ...invalid }));
});
