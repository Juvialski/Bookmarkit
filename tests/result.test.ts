import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starFills, ratingLabel, ratingSource } from '../src/utils/starRating';
import { coverCandidates, nextCover, sameCoverBook } from '../src/utils/covers';
import { BookResult, ProviderBook } from '../src/models/book';
import { primaryRating } from '../src/utils/ratings';
import { createBookEnricher, mergeEnrichment } from '../src/services/enrichBook';
import { createProgressiveLookup } from '../src/services/progressiveLookup';
import { normalizeOpenLibrary } from '../src/services/providers/openLibrary';
import { createWorkEnricher } from '../src/services/providers/workDetails';
import { identifyBook } from '../src/services/identifyBook';
import { goodreadsSearchUrl } from '../src/utils/goodreads';
import { googleBooksSearch } from '../src/services/providers/googleBooks';
import { openLibrarySearch } from '../src/services/providers/openLibrarySearch';

const book: BookResult = { title: 'Warbreaker', authors: ['Brandon Sanderson'], seriesStatus: 'standalone', ratings: [{ provider: 'Open Library', average: 4.4, count: 1284, stored: true }], warnings: [] };
const url = 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false';
test('five proportional star fills, with no rounding to half stars', () => {
  for (const [score, expected] of [[5, [1,1,1,1,1]], [4.8,[1,1,1,1,0.8]], [4.5,[1,1,1,1,0.5]], [4.2,[1,1,1,1,0.2]], [3.7,[1,1,1,0.7,0]], [1,[1,0,0,0,0]]] as const) assert.deepEqual(starFills(score), expected);
  for (const invalid of [undefined, null, NaN, Infinity, -1, 6, '4.8']) assert.deepEqual(starFills(invalid), [0,0,0,0,0]);
});
test('counts and source belong to the selected rating, including stored evidence', () => {
  const chosen = primaryRating([...book.ratings, { provider: 'Google Books', average: 5, count: 52918 }])!;
  assert.equal(ratingSource(chosen), '1,284 ratings · Open Library');
  assert.equal(ratingLabel(chosen), '4.4 out of 5 stars, 1,284 ratings, Open Library.');
  for (const [count, expected] of [[1,'1 rating'], [27,'27 ratings'], [52918,'52,918 ratings']] as const) assert.equal(ratingSource({ ...chosen, count }), `${expected} · Open Library`);
  for (const count of [undefined, 0, -1, NaN, Infinity, 1.5]) assert.equal(ratingSource({ ...chosen, count }), 'Open Library');
  for (const average of [undefined, NaN, Infinity, -1, 0, 6]) assert.equal(primaryRating([{ provider: 'Hardcover', average }]), undefined);
});
test('exact ISBN retains edition, work and verified ISBN cover alternatives', () => {
  const result = normalizeOpenLibrary({ title: book.title, covers: [-1, 123], works: [{ key: '/works/OL1W' }] }, { covers: [456] }, [], {}, '9780765320308')!;
  assert.deepEqual(result.coverUrls, [url, 'https://covers.openlibrary.org/b/id/456-L.jpg?default=false', 'https://covers.openlibrary.org/b/isbn/9780765320308-L.jpg?default=false']);
});
test('title-author search and work details retrieve covers without an ISBN', async () => {
  const found = await openLibrarySearch({ title: book.title, author: book.authors[0] }, async () => Response.json({ docs: [{ key: '/works/OL1W', title: book.title, author_name: book.authors, cover_i: 123 }] }));
  assert.equal(found[0].coverUrl, url); assert.equal(found[0].isbn, undefined);
  const enrich = createBookEnricher(async b => b, async () => [{ ...found[0], coverUrl: undefined }], createWorkEnricher(async () => Response.json({ key: '/works/OL1W', covers: [-1, 123] })));
  const result = await enrich(book); assert.equal(result.coverUrl, url); assert.deepEqual(result.authors, book.authors);
});
test('fast catalog result gets a late Open Library cover without a new scan', async () => {
  let finish!: (books: BookResult[]) => void;
  const deferred = new Promise<BookResult[]>(resolve => { finish = resolve; });
  const initial = await identifyBook({ title: book.title, author: book.authors[0], origin: 'cover' }, { catalog: { search: async () => [book] }, online: async () => true });
  assert.equal(initial.kind, 'book');
  const enrich = createBookEnricher(async b => b, async () => deferred, async b => b);
  const pending = enrich(book);
  finish([{ ...book, source: undefined, coverUrl: url, workId: '/works/OL1W', ratings: [{ provider: 'Open Library', average: 4.5, count: 27 }] }]);
  const result = await pending; assert.equal(result.coverUrl, url); assert.equal(result.ratings[0].count, 27); assert.equal(result.title, book.title);
});
test('completed ISBN enrichment remains available after pending operation cleanup', async () => {
  const isbn = '9780765320308';
  const provider: ProviderBook = { ...book, isbn, coverUrl: url, rating: book.ratings[0] };
  const progressive = createProgressiveLookup(async () => ({ ...book, isbn }), [async () => provider]);
  const first = await progressive.lookup(isbn);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await progressive.enrich(first)).coverUrl, url);
});
test('fast central catalog ISBN match without a cover gains a slow Open Library cover', async () => {
  let finish!: (value: ProviderBook) => void;
  const slow = new Promise<ProviderBook>(resolve => { finish = resolve; });
  const isbn = '9780765320308';
  const central: ProviderBook = { ...book, isbn, rating: book.ratings[0] };
  const progressive = createProgressiveLookup(async () => null, [async () => central, async () => slow]);
  const first = await progressive.lookup(isbn);
  assert.equal(first.coverUrl, undefined);
  const operation = createBookEnricher(progressive.enrich, async () => [], async b => b)(first);
  finish({ ...central, coverUrl: url, rating: { provider: 'Open Library', average: 4.5, count: 27 } });
  assert.equal((await operation).coverUrl, url);
});
test('ISBN local match absent from pending cache still retrieves cover', async () => {
  const isbn = '9780765320308';
  const progressive = createProgressiveLookup(async () => ({ ...book, isbn }), [async () => ({ ...book, isbn, coverUrl: url, rating: book.ratings[0] })]);
  assert.equal((await progressive.enrich({ ...book, isbn })).coverUrl, url);
});
test('404 or timed out first image cannot block an alternative or late metadata', () => {
  const second = 'https://books.google.com/books/content?id=matching';
  const failed = new Set([url]);
  assert.equal(nextCover([url, second], failed), second);
  assert.equal(nextCover([url], failed), undefined);
  assert.equal(nextCover([url, second], failed, second), second);
  assert.deepEqual(coverCandidates({ coverUrl: 'https://example.org/placeholder.jpg', coverUrls: ['bad', url] }), [url]);
  // Failure state is created anew for each keyed book; a different book never
  // inherits the failed URL or the loaded image from the previous selection.
  assert.equal(nextCover([url], new Set(), second), url);
});
test('matching rejects other editions, authors and conflicting known works', () => {
  assert.equal(sameCoverBook(book, { ...book, authors: ['Someone Else'], coverUrl: url }), false);
  assert.equal(sameCoverBook({ ...book, isbn: '9780765320308' }, { ...book, isbn: '9780140328721' }), false);
  assert.equal(sameCoverBook({ ...book, workId: '/works/OL1W' }, { ...book, workId: '/works/OL2W' }), false);
  assert.equal(mergeEnrichment(book, [{ ...book, authors: ['Someone Else'], coverUrl: url }]).coverUrl, undefined);
  assert.equal(mergeEnrichment({ ...book, coverUrl: url }, [{ ...book, coverUrl: 'https://books.google.com/alternative' }]).coverUrl, url);
});
test('offline lookup skips providers; failures and cancellation preserve the result', async () => {
  const result = await identifyBook({ title: book.title, author: book.authors[0] }, { catalog: { search: async () => [book] }, online: async () => false, search: async () => { assert.fail('offline network request'); } });
  assert.equal(result.kind, 'book');
  assert.deepEqual(await createBookEnricher(async b => b, async () => { throw Error('timeout'); })(book), book);
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await createBookEnricher(async b => b, async () => [{ ...book, coverUrl: url }])(book, controller.signal), book);
});
test('Google Books cover requires exact ISBN and Goodreads redirects retain identity', async () => {
  const found = await googleBooksSearch({ isbn: '9780765320308' }, async () => Response.json({ items: [{ volumeInfo: { title: book.title, industryIdentifiers: [{ identifier: '9780140328721' }], imageLinks: { thumbnail: url } } }] }));
  assert.deepEqual(found, []);
  assert.ok(goodreadsSearchUrl({ ...book, isbn: '9780765320308' }).includes('q=9780765320308'));
  assert.ok(goodreadsSearchUrl(book).includes('Warbreaker'));
});
