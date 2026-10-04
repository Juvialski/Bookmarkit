import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHardcoverLookup, normalizeHardcover, QUERY } from '../src/hardcover.mjs';
import { createBookServer } from '../src/index.mjs';
const isbn = '9780765326355';
export const fixture = { data: { editions: [{ isbn_13: isbn, title: 'The Way of Kings', image: { url: 'https://images.hardcover.app/cover.jpg' },
  book: { id: 123, title: 'Work title', slug: 'the-way-of-kings', rating: '4.56', ratings_count: 32481,
    contributions: [{ contribution: null, author: { name: 'Brandon Sanderson' } }, { contribution: 'Narrator', author: { name: 'Narrator' } }],
    featured_book_series: { compilation: false, position: 1, series: { name: 'The Stormlight Archive' } } } }] } };
const payload = change => ({ data: { editions: [{ ...fixture.data.editions[0], book: { ...fixture.data.editions[0].book, ...change } }] } });
test('exact ISBN hit, work rating/count, authors, cover, featured series and URL', () => {
  const result = normalizeHardcover(fixture, isbn);
  assert.equal(result.found, true); assert.equal(result.isbn, isbn); assert.equal(result.title, 'The Way of Kings');
  assert.equal(result.rating, 4.56); assert.equal(result.ratingsCount, 32481);
  assert.deepEqual(result.authors, ['Brandon Sanderson']); assert.equal(result.seriesPosition, '1');
  assert.equal(result.seriesName, 'The Stormlight Archive'); assert.equal(result.hardcoverId, '123');
  assert.equal(result.url, 'https://hardcover.app/books/the-way-of-kings'); assert.match(result.coverUrl, /^https:/);
});
test('ISBN miss is an explicit found false', () => assert.deepEqual(normalizeHardcover({ data: { editions: [] } }, isbn), { found: false }));
test('missing and invalid ratings/counts do not invent data', () => {
  for (const rating of [null, undefined, '', 'bad', -1, 6, Infinity]) assert.equal(normalizeHardcover(payload({ rating }), isbn).rating, undefined);
  for (const ratings_count of [null, undefined, '', 'bad', -1, 1.5, Infinity]) assert.equal(normalizeHardcover(payload({ ratings_count }), isbn).ratingsCount, undefined);
  assert.equal(normalizeHardcover(payload({ ratings_count: '20' }), isbn).ratingsCount, 20);
  assert.equal(normalizeHardcover(payload({ ratings_count: 0 }), isbn).rating, undefined);
});
test('missing authors/cover and non-HTTPS cover are safe', () => {
  const data = payload({ contributions: null, image: null }); data.data.editions[0].image = null;
  assert.deepEqual(normalizeHardcover(data, isbn).authors, []); assert.equal(normalizeHardcover(data, isbn).coverUrl, undefined);
  data.data.editions[0].image = { url: 'http://unsafe.test' }; assert.equal(normalizeHardcover(data, isbn).coverUrl, undefined);
});
test('absent, non-numbered and compilation series remain unknown', () => {
  for (const featured_book_series of [null, { compilation: true, position: 1, series: { name: 'A' } }, { compilation: false, position: null, series: { name: 'A' } }]) {
    assert.equal(normalizeHardcover(payload({ featured_book_series }), isbn).seriesName, undefined);
  }
});
test('structured fractional series positions survive the proxy', () => {
  for (const position of [0.5, 1.5]) {
    assert.equal(normalizeHardcover(payload({ featured_book_series: { compilation: false, position, series: { name: 'Example' } } }), isbn).seriesPosition, String(position));
  }
  for (const position of [-1, 0, '1.5x', Infinity]) assert.equal(normalizeHardcover(payload({ featured_book_series: { compilation: false, position, series: { name: 'Example' } } }), isbn).seriesName, undefined);
});
test('malformed GraphQL, errors, wrong ISBN and ambiguous identities fail closed', () => {
  for (const data of [null, {}, { data: {} }, { errors: [{ message: 'private' }], ...fixture }, payload({ id: null })]) assert.throws(() => normalizeHardcover(data, isbn));
  const wrong = structuredClone(fixture); wrong.data.editions[0].isbn_13 = '9780140328721'; assert.throws(() => normalizeHardcover(wrong, isbn));
  const ambiguous = structuredClone(fixture); ambiguous.data.editions.push({ ...ambiguous.data.editions[0], book: { id: 456 } }); assert.throws(() => normalizeHardcover(ambiguous, isbn));
});
test('invalid ISBN and absent token never contact upstream', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(fixture); };
  const lookup = createHardcoverLookup({ token: 'test', fetcher });
  for (const bad of ['bad', '9780765326356', '1234567890128']) await assert.rejects(lookup(bad), e => e.status === 400);
  await assert.rejects(createHardcoverLookup({ fetcher })(isbn), e => e.status === 503); assert.equal(calls, 0);
});
test('specific query sends token only upstream with ISBN variables', async () => {
  const lookup = createHardcoverLookup({ token: 'Bearer fixture-token', fetcher: async (url, init) => {
    assert.equal(url, 'https://api.hardcover.app/v1/graphql'); assert.equal(init.headers.Authorization, 'Bearer fixture-token');
    assert.ok(init.signal); const body = JSON.parse(init.body); assert.deepEqual(body.variables, { isbn }); assert.equal(body.query, QUERY);
    assert.match(QUERY, /limit: 2/); assert.match(QUERY, /limit: 8/); return Response.json(fixture);
  } });
  assert.equal((await lookup(isbn)).found, true);
});
for (const status of [401, 429, 500, 503]) test(`upstream ${status} is safe and not cached`, async () => {
  let calls = 0;
  const lookup = createHardcoverLookup({ token: 'fixture-token', fetcher: async () => { calls++; return new Response('fixture-token private error', { status }); } });
  for (let i = 0; i < 2; i++) await assert.rejects(lookup(isbn), e => !e.message.includes('fixture-token') && e.status === (status === 429 ? 503 : 502));
  assert.equal(calls, 2);
});
test('timeout covers stalled upstream; not cached', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const lookup = createHardcoverLookup({ token: 'test', fetcher: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('secret')))) });
  const request = assert.rejects(lookup(isbn), e => e.status === 504); context.mock.timers.tick(5000); await request;
});
test('invalid JSON and oversized body are rejected', async () => {
  for (const body of ['bad json', 'x'.repeat(65537)]) await assert.rejects(createHardcoverLookup({ token: 'test', fetcher: async () => new Response(body) })(isbn));
});
test('deadline also aborts a stalled response body', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const lookup = createHardcoverLookup({ token: 'test', fetcher: async (_url, init) => new Response(new ReadableStream({
    start(controller) { init.signal.addEventListener('abort', () => controller.error(Error('abort'))); started(); }
  })) });
  const rejected = assert.rejects(lookup(isbn), e => e.status === 504);
  await ready; context.mock.timers.tick(5000); await rejected;
});
test('bounded cache hits, expiration, miss TTL, eviction and concurrent coalescing', async () => {
  let time = 0, calls = 0;
  const lookup = createHardcoverLookup({ token: 'test', now: () => time, maxSize: 1, successTtlMs: 100, missTtlMs: 10,
    fetcher: async (_url, init) => { calls++; return Response.json(JSON.parse(init.body).variables.isbn === isbn ? fixture : { data: { editions: [] } }); } });
  await Promise.all([lookup(isbn), lookup(isbn)]); assert.equal(calls, 1);
  await lookup(isbn); assert.equal(calls, 1); time = 100; await lookup(isbn); assert.equal(calls, 2);
  await lookup('9780140328721'); await lookup('9780140328721'); assert.equal(calls, 3);
  time = 110; await lookup('9780140328721'); assert.equal(calls, 4);
  await lookup(isbn); assert.equal(calls, 5);
});
test('upstream concurrency is bounded', async () => {
  let finish;
  const lookup = createHardcoverLookup({ token: 'test', maxConcurrent: 1, fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const first = lookup(isbn); await assert.rejects(lookup('9780140328721'), e => e.status === 503);
  finish(Response.json(fixture)); await first;
});
test('HTTP health, normalized lookup, invalid ISBN and safe failure; no generic proxy', async context => {
  const server = createBookServer(createHardcoverLookup({ token: 'test-secret', fetcher: async () => Response.json(fixture) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
  const result = await fetch(`${base}/api/books/${isbn}/hardcover`); assert.equal(result.status, 200); assert.equal((await result.json()).rating, 4.56);
  assert.equal((await fetch(`${base}/api/books/bad/hardcover`)).status, 400);
  assert.equal((await fetch(`${base}/graphql`)).status, 404);
  assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 405);
});
test('HTTP failures never expose token, upstream message or stack', async context => {
  const server = createBookServer(async () => { throw Error('secret upstream stack'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/books/${isbn}/hardcover`);
  assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: 'Book service temporarily unavailable.' });
});
