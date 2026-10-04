import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsbn, normalizeIsbn, createScanGate } from '../src/utils/isbn';
import { normalizeGoogleBooks, googleBooks } from '../src/services/providers/googleBooks';
import { normalizeOpenLibrary, openLibrary, parseSeriesStatement } from '../src/services/providers/openLibrary';
import { lookupBook } from '../src/services/bookLookup';
import { Fetcher, json } from '../src/services/providers/shared';
import { isbn, google, edition, authors, ratings } from './fixtures';
test('ISBN prefixes, formatting, length and checksum', () => {
  assert.equal(normalizeIsbn('978-0-140-32872-1'), isbn);
  for (const value of [isbn, '9780765326355', '9791032300336', '978-0-140-32872-1']) assert.ok(isValidIsbn(value), value);
  for (const value of ['', '9780140328722', '1234567890128', '978014032872', '9780140328721x']) assert.equal(isValidIsbn(value), false);
});
test('scan gate locks synchronously, rejects different ISBN too, and resets', () => {
  const gate = createScanGate(); assert.equal(gate.acquire('bad'), false); assert.equal(gate.acquire(isbn), true);
  assert.equal(gate.acquire(isbn), false); assert.equal(gate.acquire('9780765326355'), false);
  gate.reset(); assert.equal(gate.acquire(isbn), true);
});
test('Google normalization selects matching ISBN and upgrades cover to HTTPS', () => {
  const book = normalizeGoogleBooks(google, isbn)!;
  assert.equal(book.title, 'Fantastic Mr. Fox'); assert.deepEqual(book.authors, ['Roald Dahl']);
  assert.equal(book.rating.average, 4.5); assert.equal(book.rating.count, 20); assert.match(book.coverUrl!, /^https:/);
  assert.equal(normalizeGoogleBooks(google, '9780765326355'), null);
});
test('Google missing/malformed fields are safe and not rated', () => {
  assert.equal(normalizeGoogleBooks(null, isbn), null);
  const book = normalizeGoogleBooks({ items: [{ volumeInfo: { title: 'Book', industryIdentifiers: [{ identifier: isbn }], authors: null, averageRating: '5', ratingsCount: -1 } }] }, isbn)!;
  assert.deepEqual(book.authors, []); assert.equal(book.coverUrl, undefined); assert.equal(book.rating.average, undefined); assert.equal(book.seriesStatus, 'unknown');
});
test('Open Library metadata, work-level ratings and explicit numbered series', () => {
  const book = normalizeOpenLibrary({ ...edition, series: ['Example Series ; book 2'] }, {}, authors, ratings, isbn)!;
  assert.equal(book.workId, '/works/OL45804W'); assert.deepEqual(book.authors, ['Roald Dahl']); assert.equal(book.rating.count, 100);
  assert.equal(book.seriesStatus, 'series'); assert.equal(book.seriesPosition, '2'); assert.equal(book.seriesName, 'Example Series'); assert.ok(book.coverUrl);
});
test('Open Library absent or ambiguous series stays unknown; missing fields safe', () => {
  for (const series of [undefined, ['Example Series'], ['A #1', 'B #2']]) {
    const book = normalizeOpenLibrary({ title: 'Book', series }, null, [null], null, isbn)!;
    assert.equal(book.seriesStatus, 'unknown'); assert.deepEqual(book.authors, []); assert.equal(book.rating.average, undefined); assert.equal(book.coverUrl, undefined);
  }
  assert.equal(normalizeOpenLibrary(null, null, [], null, isbn), null);
});
const success = async () => normalizeGoogleBooks(google, isbn);
const failure = async () => { throw new Error('offline'); };
test('either provider can fail while the other succeeds', async () => {
  const ol = async () => normalizeOpenLibrary(edition, {}, authors, ratings, isbn);
  for (const providers of [[success, failure], [failure, ol]]) {
    const book = await lookupBook(isbn, providers); assert.equal(book.title, 'Fantastic Mr. Fox'); assert.equal(book.warnings.length, 1); assert.equal(book.ratings.filter(r => r.unavailable).length, 1);
  }
});
test('not found, offline and invalid ISBN are distinct failures', async () => {
  await assert.rejects(lookupBook(isbn, [async () => null, async () => null]), /No book found/);
  await assert.rejects(lookupBook(isbn, [failure, failure]), /connection/);
  await assert.rejects(lookupBook('invalid', [success, success]), /valid book ISBN/);
});
test('Google adapter queries by ISBN and handles HTTP failure', async () => {
  const mock = (async (url: string) => { assert.ok(url.includes(`q=isbn:${isbn}`)); return new Response(JSON.stringify(google)); }) as Fetcher;
  assert.equal((await googleBooks(isbn, mock))?.title, 'Fantastic Mr. Fox');
  await assert.rejects(googleBooks(isbn, (async () => new Response('', { status: 503 })) as Fetcher));
});
test('Open Library optional rating failure preserves identified book', async () => {
  const mock = (async (url: string) => {
    if (url.endsWith('ratings.json')) throw new Error('offline');
    return new Response(JSON.stringify(url.includes('/isbn/') ? edition : url.includes('/authors/') ? authors[0] : {}));
  }) as Fetcher;
  const book = await openLibrary(isbn, mock); assert.equal(book?.title, 'Fantastic Mr. Fox'); assert.equal(book?.rating.unavailable, true); assert.equal(book?.warnings?.length, 1);
});
test('Open Library 404 is not found and HTTP failure is rejected', async () => {
  assert.equal(await openLibrary(isbn, (async () => new Response('', { status: 404 })) as Fetcher), null);
  await assert.rejects(openLibrary(isbn, (async () => new Response('', { status: 500 })) as Fetcher));
});
test('requests expose abort signal and propagate aborted requests', async () => {
  await assert.rejects(json('https://example.com', (async (_url, init) => { assert.ok(init?.signal); throw new Error('aborted'); }) as Fetcher), /aborted/);
});
test('a stalled request is aborted after ten seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const request = json('https://example.com', (async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('timed out')));
  })) as Fetcher);
  const rejected = assert.rejects(request, /timed out/);
  context.mock.timers.tick(10000);
  await rejected;
});

