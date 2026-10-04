import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeClassification, seriesPosition } from '../src/utils/classification';
import { normalizeOpenLibrary, parseSeriesStatement } from '../src/services/providers/openLibrary';
import { hardcover, normalizeHardcover } from '../src/services/providers/hardcover';
import { lookupBook } from '../src/services/bookLookup';
import { primaryRating } from '../src/utils/ratings';
import { hardcoverBook, isbn } from './fixtures';
import { Fetcher } from '../src/services/providers/shared';

test('fractional positions accepted; malformed and nonfinite rejected', () => {
  for (const value of ['0.5', '1.5', '2']) {
    assert.equal(seriesPosition(value), value);
    assert.equal(parseSeriesStatement(`Series, Book ${value}`)?.position, value);
    assert.equal(normalizeHardcover({ ...hardcoverBook, seriesName: 'Series', seriesPosition: value }, isbn)?.seriesPosition, value);
  }
  for (const value of ['', '-1', '0', '1e2', 'NaN', 'Infinity', '1/2', '1.2.3', '9'.repeat(400)]) assert.equal(seriesPosition(value), undefined);
});
test('equivalent explicit edition/work statements agree, different positions conflict', () => {
  const book = normalizeOpenLibrary({ title: 'Book', series: ['Series #1'] }, { series: ['series, Book 1.0'] }, [], {}, isbn)!;
  assert.equal(book.seriesStatus, 'series'); assert.equal(book.classificationSource, 'open-library');
  assert.equal(normalizeOpenLibrary({ title: 'Book', series: ['Series #1'] }, { series: ['Series #2'] }, [], {}, isbn)?.seriesStatus, 'unknown');
});
test('known evidence beats absence; contradictory affirmative evidence stays unknown', () => {
  const hc = { seriesStatus: 'series' as const, seriesName: 'Series', seriesPosition: '1', classificationSource: 'hardcover' as const };
  const unknown = { seriesStatus: 'unknown' as const };
  const standalone = { seriesStatus: 'standalone' as const, classificationSource: 'curated' as const };
  for (const books of [[hc, unknown], [unknown, hc], [hc, { ...hc, seriesPosition: '1.0' }]]) assert.equal(mergeClassification(books).seriesStatus, 'series');
  for (const books of [[hc, standalone], [hc, { ...hc, seriesPosition: '2' }], [unknown]]) assert.equal(mergeClassification(books).seriesStatus, 'unknown');
  assert.equal(mergeClassification([unknown, standalone]).classificationSource, 'curated');
});
test('online result uses curated standalone and stored rating only when online scores missing', async () => {
  const online = normalizeHardcover({ ...hardcoverBook, rating: undefined }, isbn)!;
  const stored = { isbn, title: 'Stored', authors: [], seriesStatus: 'standalone' as const, classificationSource: 'curated' as const, source: 'offline-catalog' as const, ratings: [{ provider: 'Open Library' as const, average: 4.1, stored: true }], warnings: [] };
  const result = await lookupBook(isbn, [async () => online], async () => stored);
  assert.equal(result.title, online.title); assert.equal(result.seriesStatus, 'standalone'); assert.equal(result.incomplete, true);
  assert.equal(primaryRating(result.ratings)?.average, 4.1);
  const live = await lookupBook(isbn, [async () => ({ ...online, rating: { provider: 'Open Library', average: 4.3 } })], async () => stored);
  assert.equal(primaryRating(live.ratings)?.average, 4.3); assert.equal(live.ratings.length, 1);
});
test('rating priority, invalid values, absent counts and no rating', () => {
  assert.equal(primaryRating([{ provider: 'Open Library', average: 4 }, { provider: 'Hardcover', average: 4.5 }])?.provider, 'Hardcover');
  for (const average of [NaN, Infinity, 0, -1, 6]) assert.equal(primaryRating([{ provider: 'Hardcover', average }, { provider: 'Open Library', average: 4 }])?.provider, 'Open Library');
  assert.equal(primaryRating([{ provider: 'Hardcover' }]), undefined);
  assert.equal(primaryRating([{ provider: 'Hardcover', average: 4 }])?.count, undefined);
});
test('unavailable optional proxy adds at most the 2.5 second deadline to OL success', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const fetcher = (async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(Error('offline'))))) as Fetcher;
  const pending = lookupBook(isbn, [value => hardcover(value, fetcher, 'https://proxy.test'), async () => normalizeOpenLibrary({ title: 'Book' }, {}, [], { summary: { average: 4.2 } }, isbn)]);
  context.mock.timers.tick(2500);
  const book = await pending;
  assert.equal(primaryRating(book.ratings)?.provider, 'Open Library'); assert.equal(book.warnings.length, 0);
});
