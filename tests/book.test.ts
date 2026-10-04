import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsbn, normalizeIsbn, createScanGate } from '../src/utils/isbn';
import { normalizeHardcover, hardcover } from '../src/services/providers/hardcover';
import { normalizeOpenLibrary, openLibrary, parseSeriesStatement } from '../src/services/providers/openLibrary';
import { lookupBook, createCachedLookup } from '../src/services/bookLookup';
import { Fetcher, json, ProviderError } from '../src/services/providers/shared';
import { goodreadsSearchUrl } from '../src/utils/goodreads';
import { primaryRating, visibleRatings } from '../src/utils/ratings';
import { isbn, hardcoverBook, edition, authors, ratings } from './fixtures';

const success = async () => normalizeHardcover(hardcoverBook, isbn);
const ol = async () => normalizeOpenLibrary(edition, {}, authors, ratings, isbn);
const failure = async () => { throw new ProviderError('network'); };
test('ISBN checksum and synchronous scan gate', () => {
  assert.equal(normalizeIsbn('978-0-140-32872-1'), isbn);
  for (const value of [isbn, '9780765326355', '9791032300336']) assert.ok(isValidIsbn(value));
  for (const value of ['', '9780140328722', '1234567890128', '978014032872', '9780140328721x']) assert.equal(isValidIsbn(value), false);
  const gate = createScanGate(); assert.equal(gate.acquire('bad'), false); assert.equal(gate.acquire(isbn), true);
  assert.equal(gate.acquire('9780765326355'), false); gate.reset(); assert.equal(gate.acquire(isbn), true);
});
test('Hardcover normalized endpoint contract, missing fields and HTTPS cover', async () => {
  assert.equal(normalizeHardcover({ found: false }, isbn), null);
  for (const data of [null, {}, { ...hardcoverBook, isbn: 'other' }]) assert.throws(() => normalizeHardcover(data, isbn), ProviderError);
  const book = normalizeHardcover({ ...hardcoverBook, authors: null, coverUrl: 'http://unsafe.test', rating: '4.5' }, isbn)!;
  assert.deepEqual(book.authors, []); assert.equal(book.coverUrl, undefined); assert.equal(book.rating.average, undefined);
  const mock = (async (url, init) => {
    assert.equal(url, `http://10.0.2.2:3001/api/books/${isbn}/hardcover`);
    assert.equal(init?.headers, undefined); return Response.json(hardcoverBook);
  }) as Fetcher;
  assert.equal((await hardcover(isbn, mock, 'http://10.0.2.2:3001'))?.hardcoverId, '123');
  for (const base of ['', 'http://remote.test', 'https://secret@remote.test']) await assert.rejects(hardcover(isbn, mock, base), ProviderError);
  for (const status of [401, 429, 503]) await assert.rejects(hardcover(isbn, (async () => new Response('', { status })) as Fetcher, 'https://proxy.test'), ProviderError);
});
test('both ratings stay separate, Hardcover metadata takes precedence', async () => {
  const result = await lookupBook(isbn, [success, ol]);
  assert.deepEqual(result.ratings.map(r => r.provider), ['Hardcover', 'Open Library']);
  assert.deepEqual(visibleRatings(result.ratings).map(r => r.average), [4.5, 4.3]);
  assert.equal(primaryRating(result.ratings)?.provider, 'Hardcover');
  assert.equal(result.hardcoverId, '123'); assert.equal(result.incomplete, false);
});
test('either source can fail or miss without empty cards or provider warnings', async () => {
  for (const providers of [[success, failure], [failure, ol], [async () => null, ol]]) {
    const result = await lookupBook(isbn, providers);
    assert.equal(result.title, 'Fantastic Mr. Fox'); assert.equal(result.ratings.length, 1);
    assert.equal(result.warnings.length, 0); assert.equal(visibleRatings(result.ratings).length, 1);
  }
  assert.deepEqual(visibleRatings([{ provider: 'Hardcover' }, { provider: 'Open Library', average: 4, unavailable: true }]), []);
  assert.equal(primaryRating([{ provider: 'Open Library', average: 4.2 }])?.provider, 'Open Library');
});
test('not found, offline and invalid input remain distinct', async () => {
  await assert.rejects(lookupBook(isbn, [async () => null, async () => null]), /No book found/);
  await assert.rejects(lookupBook(isbn, [failure, failure]), /Internet unavailable/);
  await assert.rejects(lookupBook('invalid', [success, ol]), /valid book ISBN/);
});
test('series structured Hardcover; conflicts unknown; fallback fields deterministic', async () => {
  const primary = normalizeHardcover({ ...hardcoverBook, seriesName: 'Example', seriesPosition: '2' }, isbn)!;
  const secondary = normalizeOpenLibrary({ ...edition, title: 'Other title', series: ['Example #2'] }, {}, authors, ratings, isbn)!;
  const result = await lookupBook(isbn, [async () => ({ ...primary, authors: [], coverUrl: undefined }), async () => secondary]);
  assert.equal(result.title, primary.title); assert.deepEqual(result.authors, secondary.authors);
  assert.equal(result.coverUrl, secondary.coverUrl); assert.equal(result.seriesName, 'Example');
  for (const change of [{ seriesName: 'Other' }, { seriesPosition: '3' }]) {
    assert.equal((await lookupBook(isbn, [async () => ({ ...primary, ...change }), async () => secondary])).seriesStatus, 'unknown');
  }
  assert.equal((await lookupBook(isbn, [async () => primary, ol])).seriesPosition, '2');
});
test('Open Library work ratings and absent or ambiguous metadata', () => {
  const book = normalizeOpenLibrary({ ...edition, series: ['Example Series ; book 2'] }, {}, authors, ratings, isbn)!;
  assert.equal(book.workId, '/works/OL45804W'); assert.equal(book.rating.count, 100); assert.equal(book.seriesPosition, '2');
  for (const series of [undefined, ['Example'], ['A #1', 'B #2']]) assert.equal(normalizeOpenLibrary({ title: 'Book', series }, null, [null], null, isbn)?.seriesStatus, 'unknown');
  assert.equal(normalizeOpenLibrary(null, null, [], null, isbn), null);
});
for (const [statement, position] of [['The Stormlight Archive #1', '1'], ['Series ; book 2', '2'], ['Series, Vol. 3', '3'], ['Series (Volume 4)', '4'], ['Series : no. 5', '5'], ['Series - Book 2.5.', '2.5'], ['Series (#6)', '6']]) {
  test(`explicit series: ${statement}`, () => assert.equal(parseSeriesStatement(statement)?.position, position));
}
test('ambiguous and conflicting Open Library series stay unknown', () => {
  for (const statement of ['Series 1', 'Series (Book 2', 'Series Book 2)', 'Series #0', 'Series #1 / Other #2']) assert.equal(parseSeriesStatement(statement), null);
  assert.equal(normalizeOpenLibrary({ ...edition, series: ['A #1'] }, { series: ['B #2'] }, [], {}, isbn)?.seriesStatus, 'unknown');
});
test('Open Library optional failures preserve edition and deduplicate author requests', async () => {
  const urls: string[] = [];
  const book = await openLibrary(isbn, (async url => {
    urls.push(String(url));
    if (String(url).includes('/isbn/')) return Response.json({ ...edition, authors: [edition.authors[0], edition.authors[0]] });
    throw Error('offline');
  }) as Fetcher);
  assert.equal(book?.title, edition.title); assert.equal(book?.rating.unavailable, true);
  assert.equal(urls.filter(url => url.includes('/authors/')).length, 1);
  assert.equal(await openLibrary(isbn, (async () => new Response('', { status: 404 })) as Fetcher), null);
  await assert.rejects(openLibrary(isbn, (async () => new Response('', { status: 500 })) as Fetcher));
});
test('network requests abort on bounded deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const request = json('https://example.com', (async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(Error('abort')));
  })) as Fetcher);
  const rejected = assert.rejects(request, /timeout/); context.mock.timers.tick(10000); await rejected;
});
test('session cache expiration, eviction, offline reconnection and partial retry', async () => {
  let time = 0, calls = 0;
  const book = await lookupBook(isbn, [success, ol]);
  const cached = createCachedLookup(async value => { calls++; return { ...book, isbn: value }; }, () => time, 1, 100);
  await cached(isbn); await cached('978-0-140-32872-1'); assert.equal(calls, 1);
  time = 100; await cached(isbn); assert.equal(calls, 2);
  await cached('9780765326355'); await cached(isbn); assert.equal(calls, 4);
  for (const change of [{ incomplete: true }, { source: 'offline-catalog' as const }]) {
    const partial = createCachedLookup(async () => { calls++; return { ...book, ...change }; }, () => time);
    const before: number = calls; await partial(isbn); await partial(isbn); assert.equal(calls, before + 1);
    time += 30000; await partial(isbn); assert.equal(calls, before + 2);
  }
  const rejected = createCachedLookup(failure); await assert.rejects(rejected(isbn)); await assert.rejects(rejected(isbn));
});
test('Goodreads uses only checksum-valid ISBN as external search term', () => {
  const url = new URL(goodreadsSearchUrl('978-0-140-32872-1'));
  assert.equal(url.hostname, 'www.goodreads.com'); assert.equal(url.searchParams.get('q'), isbn);
  assert.throws(() => goodreadsSearchUrl('bad'));
});
test('default lookup never contacts Google, even when both normal sources fail', async context => {
  const urls: string[] = [];
  const previous = process.env.EXPO_PUBLIC_BOOK_API_BASE_URL;
  process.env.EXPO_PUBLIC_BOOK_API_BASE_URL = 'https://proxy.test';
  context.after(() => { if (previous === undefined) delete process.env.EXPO_PUBLIC_BOOK_API_BASE_URL; else process.env.EXPO_PUBLIC_BOOK_API_BASE_URL = previous; });
  context.mock.method(globalThis, 'fetch', async (url: string) => { urls.push(String(url)); throw Error('offline'); });
  await assert.rejects(lookupBook(isbn), /Internet unavailable/);
  assert.equal(urls.length, 2);
  assert.ok(urls.some(url => url.startsWith('https://proxy.test/api/books/')));
  assert.ok(urls.some(url => url.startsWith('https://openlibrary.org/isbn/')));
  assert.ok(urls.every(url => !/google|goodreads/.test(url)));
});
