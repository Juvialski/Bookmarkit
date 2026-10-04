import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalCatalog, normalizeLocalRecord } from '../src/services/localCatalog';
import { lookupBook } from '../src/services/bookLookup';
import { ProviderError } from '../src/services/providers/shared';
import { normalizeOpenLibrary } from '../src/services/providers/openLibrary';
const isbn = '9780765326355';
const row = { isbn13: isbn, title: 'The Way of Kings', authors: '["Brandon Sanderson"]', series_status: 'series', series_name: 'The Stormlight Archive', series_position: '1', rating: 4.5, rating_count: 166 };
const local = async () => normalizeLocalRecord(row, isbn);
const failure = async () => { throw new ProviderError('network'); };
test('parameterized local hit and miss, invalid ISBN avoids query', async () => {
  let calls = 0;
  const lookup = createLocalCatalog({ async getFirstAsync<T>(sql: string, value: string) { calls++; assert.equal(sql, 'SELECT * FROM books WHERE isbn13 = ?'); return (value === isbn ? row : null) as T | null; } });
  assert.equal((await lookup(isbn))?.title, row.title);
  assert.equal(await lookup('9780140328721'), null);
  assert.equal(await lookup('bad'), null); assert.equal(calls, 2);
});
test('local rating, series and offline provenance normalized', () => {
  const book = normalizeLocalRecord(row, isbn)!;
  assert.equal(book.source, 'offline-catalog'); assert.equal(book.ratings[0].provider, 'Open Library');
  assert.equal(book.ratings[0].average, 4.5); assert.equal(book.ratings[0].count, 166);
  assert.equal(book.seriesStatus, 'series'); assert.equal(book.seriesPosition, '1'); assert.equal(book.coverUrl, undefined);
});
test('absent and malformed ratings and series stay conservative', () => {
  for (const rating of [null, -1, '4', 6]) assert.equal(normalizeLocalRecord({ ...row, rating }, isbn)!.ratings[0].average, undefined);
  const book = normalizeLocalRecord({ ...row, rating: null, rating_count: null, series_name: null }, isbn)!;
  assert.equal(book.seriesStatus, 'unknown'); assert.equal(book.ratings[0].count, undefined);
  assert.equal(normalizeLocalRecord({ ...row, rating_count: 0 }, isbn)!.ratings[0].average, undefined);
});
test('malformed records fail closed', () => {
  for (const bad of [null, {}, { ...row, title: '' }, { ...row, authors: '{}' }, { ...row, authors: 'bad' }, { ...row, isbn13: 'bad' }]) assert.equal(normalizeLocalRecord(bad, isbn), null);
});
test('standalone requires curated catalog provenance', () => {
  assert.equal(normalizeLocalRecord({ ...row, series_status: 'standalone' }, isbn)?.seriesStatus, 'unknown');
  assert.equal(normalizeLocalRecord({ ...row, series_status: 'standalone', classification_source: 'curated' }, isbn)?.seriesStatus, 'standalone');
});
test('both providers fail then local success; timeout also falls back', async () => {
  assert.equal((await lookupBook(isbn, [failure, failure], local)).source, 'offline-catalog');
  assert.equal((await lookupBook(isbn, [async () => { throw new ProviderError('timeout'); }, failure], local)).title, row.title);
});
test('both providers fail and local miss gives clear message', async () => {
  await assert.rejects(lookupBook(isbn, [failure, failure], async () => null), /not in the offline catalog/);
});
test('catalog failure cannot discard online success or partial success', async () => {
  const online = async () => normalizeOpenLibrary({ title: 'Online title' }, {}, [], {}, isbn);
  const unused = async () => { throw Error('unreadable catalog'); };
  for (const providers of [[online, online], [online, failure]]) {
    const book = await lookupBook(isbn, providers, unused);
    assert.equal(book.title, 'Online title'); assert.equal(book.source, undefined);
  }
});
test('provider not found may use catalog; unreadable catalog is explained', async () => {
  assert.equal((await lookupBook(isbn, [async () => null, async () => null], local)).source, 'offline-catalog');
  await assert.rejects(lookupBook(isbn, [failure, failure], async () => { throw Error('db'); }), /catalog could not be read/);
});
