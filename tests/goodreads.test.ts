import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachGoodreads } from '../src/services/providers/goodreads';
import { primaryRating } from '../src/utils/ratings';
import { goodreadsReviewsUrl } from '../src/utils/goodreads';
import { ratingLabel, ratingScore, starFills } from '../src/utils/starRating';
import { normalizeLocalRecord } from '../src/services/localCatalog';
import { validRecord } from '../supabase/functions/goodreads-ingest/validate';
import { BookResult } from '../src/models/book';
const book: BookResult = { workId: '/works/OL1W', isbn: '9780439023481', title: 'A fixture', authors: ['Test Author'], seriesStatus: 'unknown', ratings: [{ provider: 'Hardcover', average: 5 }, { provider: 'Open Library', average: 4.5 }], warnings: [] };
const record = { book_id: '123', goodreads_work_id: '456', work_id: book.workId, isbn13: book.isbn, average: 4.83, rating_count: 1284631,
  url: 'https://www.goodreads.com/book/show/123-a-fixture', rating_scope: 'edition', retrieved_at: '2026-01-01T00:00:00Z',
  status: 'verified', match_confidence: 'exact_isbn', evidence: { method: 'goodread-v0.3.1', title: book.title, authors: book.authors, matched_isbn: book.isbn }, series_name: 'Test Series', series_position: '2' };
test('verified Goodreads takes precedence, preserves exact count, precision and five proportional stars', () => {
  const result = attachGoodreads(book, [record]); const rating = primaryRating(result.ratings)!;
  assert.equal(rating.provider, 'Goodreads'); assert.equal(rating.count, 1284631); assert.equal(ratingScore(rating), '4.83');
  assert.equal(ratingLabel(rating), '4.83 out of 5 stars, 1,284,631 ratings, Goodreads.');
  assert.deepEqual(starFills(rating.average), [1, 1, 1, 1, 0.83]);
  assert.equal(goodreadsReviewsUrl(result), record.url); assert.equal(result.seriesPosition, '2');
  assert.equal(attachGoodreads({ ...book, seriesStatus: 'standalone' }, [record]).seriesStatus, 'standalone');
});
test('edition rating cannot leak into a different edition, another work or a work-only match', () => {
  for (const candidate of [{ ...book, isbn: undefined }, { ...book, isbn: '9780140328721' }, { ...book, workId: '/works/OL2W' }])
    assert.equal(primaryRating(attachGoodreads(candidate, [record]).ratings)?.provider, 'Hardcover');
  assert.equal(primaryRating(attachGoodreads({ ...book, isbn: undefined }, [{ ...record, rating_scope: 'work' }]).ratings)?.provider, 'Goodreads');
});
test('invalid and ambiguous records fail closed and retain the trustworthy fallback', () => {
  for (const patch of [{ status: 'ambiguous' }, { average: 6 }, { average: NaN }, { rating_count: 1.2 }, { rating_count: 0 },
    { match_confidence: 'fuzzy' }, { url: 'https://evil.example/book/show/123' }, { retrieved_at: 'invalid' }])
    assert.equal(primaryRating(attachGoodreads(book, [{ ...record, ...patch }]).ratings)?.provider, 'Hardcover');
  assert.equal(primaryRating([{ provider: 'Goodreads', average: 5, count: 10 }, ...book.ratings])?.provider, 'Hardcover');
  assert.ok(goodreadsReviewsUrl(book).includes('q=9780439023481'));
});
test('offline catalog accepts optional cached summaries and retains legacy catalog compatibility', () => {
  const row = { isbn13: book.isbn, title: book.title, authors: JSON.stringify(book.authors), work_id: book.workId, series_status: 'unknown', rating: 4, rating_count: 20 };
  assert.equal(primaryRating(normalizeLocalRecord(row, book.isbn!)!.ratings)?.provider, 'Open Library');
  const offline = normalizeLocalRecord({ ...row, goodreads_json: JSON.stringify([record]) }, book.isbn!)!;
  assert.equal(primaryRating(offline.ratings)?.provider, 'Goodreads'); assert.equal(primaryRating(offline.ratings)?.stored, true);
  assert.equal(goodreadsReviewsUrl(offline), record.url);
  const workOnly = normalizeLocalRecord({ ...row, goodreads_json: JSON.stringify([record]) }, book.isbn!, true)!;
  assert.equal(primaryRating(workOnly.ratings)?.provider, 'Open Library'); assert.equal(workOnly.seriesStatus, 'unknown');
  assert.equal(primaryRating(normalizeLocalRecord({ ...row, goodreads_json: '{' }, book.isbn!)!.ratings)?.provider, 'Open Library');
});
test('ingestion validates source identity, scores, counts, series and provenance', () => {
  assert.equal(validRecord(record), true);
  for (const patch of [{ average: 6 }, { rating_count: Number.MAX_SAFE_INTEGER + 1 }, { evidence: {} }, { status: 'unmatched' },
    { isbn13: null }, { url: 'https://www.goodreads.com/book/show/999' }, { series_position: '1-3' }, { retrieved_at: '2999-01-01T00:00:00Z' }])
    assert.equal(validRecord({ ...record, ...patch }), false);
});
