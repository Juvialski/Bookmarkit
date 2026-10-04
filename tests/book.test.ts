import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsbn, normalizeIsbn, createScanGate } from '../src/utils/isbn';
import { normalizeGoogleBooks, googleBooks } from '../src/services/providers/googleBooks';
import { normalizeOpenLibrary, openLibrary, parseSeriesStatement } from '../src/services/providers/openLibrary';
import { lookupBook, createCachedLookup } from '../src/services/bookLookup';
import { Fetcher, json, ProviderError } from '../src/services/providers/shared';
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
  assert.throws(() => normalizeGoogleBooks(null, isbn), ProviderError);
  assert.equal(normalizeGoogleBooks({ totalItems: 0 }, isbn), null);
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
  await assert.rejects(json('https://example.com', (async (_url, init) => { assert.ok(init?.signal); throw new Error('aborted'); }) as Fetcher), /network/);
});
test('a stalled request is aborted after ten seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const request = json('https://example.com', (async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('timed out')));
  })) as Fetcher);
  const rejected = assert.rejects(request, /timeout/);
  context.mock.timers.tick(10000);
  await rejected;
});

for (const status of [429, 500, 503]) {
  test(`Google retries ${status} once with a bounded delay`, async () => {
    let calls = 0;
    const mock = (async () => ++calls === 1 ? new Response('', { status }) : new Response(JSON.stringify(google))) as Fetcher;
    assert.equal((await googleBooks(isbn, mock, '', async ms => { assert.equal(ms, 500); }))?.title, 'Fantastic Mr. Fox');
    assert.equal(calls, 2);
  });
}
test('Google exhausted retry and nontransient responses have a strict request bound', async () => {
  for (const status of [429, 503, 403]) {
    let calls = 0;
    await assert.rejects(googleBooks(isbn, (async () => { calls++; return new Response('', { status }); }) as Fetcher, '', async () => {}), ProviderError);
    assert.equal(calls, status === 403 ? 1 : 2);
  }
});
test('Google API key is optional, trimmed and URL encoded', async () => {
  for (const key of ['', '  ', ' test&key ']) {
    await googleBooks(isbn, (async url => {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get('key'), key.trim() || null);
      return new Response(JSON.stringify(google));
    }) as Fetcher, key);
  }
});
test('Google malformed JSON and empty responses are distinct; no retry', async () => {
  let calls = 0;
  await assert.rejects(googleBooks(isbn, (async () => { calls++; return new Response('bad json'); }) as Fetcher, ''), /malformed/);
  assert.equal(calls, 1);
  assert.equal(await googleBooks(isbn, (async () => new Response('{"totalItems":0}')) as Fetcher, ''), null);
});
test('Google timeout is not retried', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const request = googleBooks(isbn, (async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('abort'))));
  }) as Fetcher, '');
  const rejected = assert.rejects(request, /timeout/);
  context.mock.timers.tick(5000); await rejected; assert.equal(calls, 1);
});
test('merge precedence and fallback fields do not depend on response timing', async () => {
  const primary = normalizeGoogleBooks(google, isbn)!;
  const secondary = normalizeOpenLibrary({ ...edition, title: 'Other title', series: ['Series #2'] }, {}, authors, ratings, isbn)!;
  const result = await lookupBook(isbn, [async () => ({ ...primary, authors: [], coverUrl: 'javascript:bad' }), async () => secondary]);
  assert.equal(result.title, primary.title); assert.deepEqual(result.authors, secondary.authors);
  assert.equal(result.coverUrl, secondary.coverUrl); assert.equal(result.seriesName, 'Series');
  assert.deepEqual(result.ratings.map(r => r.average), [4.5, 4.3]);
  const conflict = await lookupBook(isbn, [async () => ({ ...primary, seriesStatus: 'series', seriesName: 'Other', seriesPosition: '1' }), async () => secondary]);
  assert.equal(conflict.seriesStatus, 'unknown');
});
test('both offline, rate limiting and all unavailable have understandable errors', async () => {
  const failed = (kind: 'network' | 'rate-limit' | 'server') => async () => { throw new ProviderError(kind); };
  await assert.rejects(lookupBook(isbn, [failed('network'), failed('network')]), /Internet unavailable/);
  await assert.rejects(lookupBook(isbn, [failed('rate-limit'), failed('server')]), /busy/);
  await assert.rejects(lookupBook(isbn, [failed('server'), failed('server')]), /services are unavailable/);
  const partial = await lookupBook(isbn, [failed('rate-limit'), success]);
  assert.match(partial.warnings[0], /busy/);
});
for (const [statement, position] of [['The Stormlight Archive #1', '1'], ['Series ; book 2', '2'], ['Series, Vol. 3', '3'], ['Series (Volume 4)', '4'], ['Series : no. 5', '5'], ['Series - Book 2.5.', '2.5'], ['Series (#6)', '6']]) {
  test(`explicit series: ${statement}`, () => {
    assert.equal(parseSeriesStatement(statement)?.position, position);
    assert.ok(!/[;,:-]$/.test(parseSeriesStatement(statement)!.name));
  });
}
test('ambiguous statements, mismatched punctuation and conflicting sources stay unknown', () => {
  for (const statement of ['Series 1', 'Series (Book 2', 'Series Book 2)', 'Series #0', 'Series #1 / Other #2', 'Series Book 1 Book 2']) assert.equal(parseSeriesStatement(statement), null, statement);
  assert.equal(normalizeOpenLibrary({ ...edition, series: ['A #1'] }, { series: ['B #2'] }, [], {}, isbn)?.seriesStatus, 'unknown');
  assert.equal(normalizeOpenLibrary({ ...edition, subjects: ['Series #1'] }, {}, [], {}, isbn)?.seriesStatus, 'unknown');
});
test('Open Library deduplicates author requests and keeps edition after optional failures', async () => {
  const urls: string[] = [];
  const result = await openLibrary(isbn, (async url => {
    urls.push(String(url));
    if (String(url).includes('/isbn/')) return new Response(JSON.stringify({ ...edition, authors: [edition.authors[0], edition.authors[0]] }));
    throw new Error('offline');
  }) as Fetcher);
  assert.equal(result?.title, edition.title); assert.equal(result?.rating.unavailable, true);
  assert.equal(urls.filter(url => url.includes('/authors/')).length, 1);
});
test('cache normalizes ISBN, expires, evicts, and does not retain failures', async () => {
  let time = 0, calls = 0;
  const book = await lookupBook(isbn, [success, success]);
  const cached = createCachedLookup(async value => { calls++; return { ...book, isbn: value }; }, () => time, 1, 100);
  await cached(isbn); await cached('978-0-140-32872-1'); assert.equal(calls, 1);
  time = 100; await cached(isbn); assert.equal(calls, 2);
  await cached('9780765326355'); await cached(isbn); assert.equal(calls, 4);
  const partial = createCachedLookup(async () => { calls++; return { ...book, warnings: ['unavailable'] }; }, () => time);
  await partial(isbn); await partial(isbn); assert.equal(calls, 5);
  time += 30000; await partial(isbn); assert.equal(calls, 6);
  const rejected = createCachedLookup(async () => { calls++; throw new Error('offline'); });
  await assert.rejects(rejected(isbn)); await assert.rejects(rejected(isbn)); assert.equal(calls, 8);
  await assert.rejects(cached('invalid')); assert.equal(calls, 8);
});

