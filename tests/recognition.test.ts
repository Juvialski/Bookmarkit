import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookResult } from '../src/models/book';
import { interpretCover } from '../src/recognition/coverParser';
import { normalizeText, titleSimilarity, authorSimilarity } from '../src/recognition/normalization';
import { matchBook, rankBooks } from '../src/recognition/matching';
import { identifyBook, manualQuery } from '../src/services/identifyBook';
import { createLocalSearch } from '../src/services/localCatalog';
import { goodreadsSearchUrl } from '../src/utils/goodreads';
import { openLibrarySearch } from '../src/services/providers/openLibrarySearch';
import { ProviderError } from '../src/services/providers/shared';
import { covers, fixtureCover } from './ocrFixtures';
const book = (title = 'The Hobbit', author = 'J.R.R. Tolkien', key = '1'): BookResult => ({ isbn: '', title, authors: [author], workId: `/works/OL${key}W`, seriesStatus: 'unknown', ratings: [], warnings: [] });
test('normalization handles case, accents, punctuation, hyphens, curly apostrophes and initials', () => {
  assert.equal(normalizeText('  GABRÍEL—García  Márquez '), 'gabriel garcia marquez');
  assert.equal(normalizeText('Philosopher’s Stone'), normalizeText("PHILOSOPHER'S STONE"));
  assert.equal(authorSimilarity('J. R. R. Tolkien', ['J.R.R. Tolkien']), 1);
  assert.equal(authorSimilarity('JRR Tolkien', ['John Ronald Reuel Tolkien']), 0.94);
  assert.equal(authorSimilarity('James Smith', ['John Smith']), 0);
  assert.equal(authorSimilarity('James Clear', ['George Orwell']), 0);
  assert.equal(titleSimilarity('The Hobbit', 'The Hobbit: There and Back Again'), 0.96);
  assert.equal(titleSimilarity('TheHobbit', 'The Hobbit'), 0.95);
  assert.equal(titleSimilarity('The Hobb1t', 'The Hobbit') > 0.82, true);
  assert.equal(titleSimilarity('The Hobbit', 'The Hobbit Companion') < 0.82, true);
});
for (const fixture of covers) test(`noisy cover title/author candidates and exact resolution: ${fixture.title}`, () => {
  const candidates = interpretCover(fixtureCover(fixture));
  assert.ok(candidates.some(q => normalizeText(q.title!) === normalizeText(fixture.title) && normalizeText(q.author || '') === normalizeText(fixture.author)), JSON.stringify(candidates));
  assert.ok(!candidates.some(q => /bestseller|a novel|penguin books/i.test(q.title || '')));
  const result = rankBooks(candidates, [book(fixture.title, fixture.author)]);
  assert.equal(result?.kind, 'book');
});
test('subtitle and review filtering retains real title text', () => {
  const values = interpretCover({ text: '', blocks: [{ text: 'Bestseller: A Story of Fame' }, { text: 'JANE AUSTEN' }, { text: '“A breathtaking novel” — Reviewer' }] });
  assert.ok(values.some(v => v.title === 'Bestseller: A Story of Fame'));
  assert.ok(!values.some(v => v.title?.includes('breathtaking')));
});
test('single-block OCR generates both author-first and title-first splits', () => {
  const result = interpretCover({ text: 'GEORGE ORWELL\n1984', blocks: [{ text: 'GEORGE ORWELL\n1984' }] });
  assert.ok(result.some(q => q.title === '1984' && q.author === 'George Orwell'));
});
test('separate adjacent title/author lines combine using boxes', () => {
  const texts = ['THE WAY', 'OF KINGS', 'BRANDON', 'SANDERSON'];
  const result = interpretCover({ text: texts.join('\n'), blocks: texts.map((text, i) => ({ text, boundingBox: { x: 10, y: [10, 60, 400, 450][i], width: 200, height: 40 } })) });
  // Full joined author and title may be split into distinct blocks: include
  // native grouped variants and retain alternatives instead of one guess.
  assert.ok(result.some(q => normalizeText(q.title!) === 'the way of kings'));
  assert.ok(result.some(q => normalizeText(q.author || '') === 'brandon sanderson'));
  assert.ok(result.some(q => normalizeText(q.title || '') === 'the way of kings' && normalizeText(q.author || '') === 'brandon sanderson'));
});
test('exact ISBN takes priority over conflicting cover text', async () => {
  const expected = { ...book(), isbn: '9780547928227' };
  const result = await identifyBook({ isbn: expected.isbn, candidates: [{ title: 'Atomic Habits', author: 'James Clear' }] }, { isbn: async value => { assert.equal(value, expected.isbn); return expected; }, search: async () => { throw Error('Must not search'); } });
  assert.deepEqual(result, { kind: 'book', book: expected });
});
test('wrong author rejects exact title; typo matching remains a chooser', () => {
  assert.equal(matchBook({ title: 'The Hobbit', author: 'James Clear' }, book()).score, 0);
  assert.equal(rankBooks([{ title: 'The Hobb1t', author: 'J.R.R. Tolkien' }], [book()])?.kind, 'candidates');
  assert.equal(rankBooks([{ title: 'The Hobbit', author: 'J.R.R. Tolkien' }], [book()])?.kind, 'book');
});
test('different same-title authors remain ambiguous and list is capped at four', () => {
  const results = Array.from({ length: 6 }, (_, i) => book('The Alchemist', `Author ${i}`, String(i)));
  const result = rankBooks([{ title: 'The Alchemist' }], results);
  assert.equal(result?.kind, 'candidates');
  if (result?.kind === 'candidates') assert.equal(result.books.length, 4);
});
test('high-confidence unique title-only fallback and short uncertain title', () => {
  assert.equal(rankBooks([{ title: 'Project Hail Mary' }], [book('Project Hail Mary', 'Andy Weir')])?.kind, 'book');
  assert.equal(rankBooks([{ title: 'Dune' }], [book('Dune', 'Frank Herbert')])?.kind, 'candidates');
});
test('manual ISBN, title, title/author and author/title order including omitted leading article', async () => {
  assert.equal(manualQuery('978-0547928227').isbn, '9780547928227');
  assert.throws(() => manualQuery('9780547928228'), /valid/);
  assert.equal(manualQuery('1984').text, '1984');
  for (const value of ['The Hobbit', 'The Hobbit J.R.R. Tolkien', 'J.R.R. Tolkien The Hobbit']) {
    const result = await identifyBook(manualQuery(value), { search: async () => [book()] });
    assert.equal(result.kind, 'book');
  }
  assert.ok(matchBook(manualQuery('Brandon Sanderson Way of Kings'), book('The Way of Kings', 'Brandon Sanderson')).certain);
  assert.equal(rankBooks([manualQuery('The Hobbit Tolkien')], [book()])?.kind, 'candidates');
  assert.equal(rankBooks([manualQuery('J.R.R. Tolkien')], [book()])?.kind, 'candidates');
});
test('Goodreads title/author fallback without ISBN and ISBN preference', () => {
  assert.match(goodreadsSearchUrl(book()), /q=The%20Hobbit%20J.R.R.%20Tolkien/);
  assert.match(goodreadsSearchUrl({ ...book(), isbn: '9780547928227' }), /q=9780547928227/);
});
test('offline local title lookup is bounded, deduplicated and keeps rating/classification provenance', async () => {
  let reads = 0;
  const row = { isbn13: '9780547928227', title: 'The Hobbit', authors: '["J.R.R. Tolkien"]', work_id: '/works/OL1W', rating: 4.2, rating_count: 100 };
  const catalog = createLocalSearch({ async getFirstAsync<T>() { return null as T | null; }, async getAllAsync<T>() { reads++; return [row, { ...row, isbn13: '9780547928227' }] as T[]; } });
  const result = await identifyBook(manualQuery('The Hobbit'), { catalog, online: async () => false, search: async () => { throw Error('Offline must not search'); } });
  assert.equal(result.kind, 'book');
  if (result.kind === 'book') { assert.equal(result.book.source, 'offline-catalog'); assert.equal(result.book.ratings[0].stored, true); }
  await catalog.search({ title: 'The Hobbit' }); assert.equal(reads, 2);
});
test('cover OCR success/local miss says connect, never says OCR failed', async () => {
  await assert.rejects(identifyBook({ origin: 'cover', candidates: [{ title: 'Uncataloged Book' }] }, { catalog: { search: async () => [] }, online: async () => false }), /Book cover read successfully.*Connect/);
  await assert.rejects(identifyBook({ origin: 'cover', title: 'Uncataloged Book' }, { search: async () => { throw new ProviderError('network'); } }), /Book cover read successfully.*Connect/);
});
test('broken catalog preserves online success; outages preserve local data; queries are bounded', async () => {
  const catalog = { search: async () => { throw Error('db'); } };
  assert.equal((await identifyBook({ title: 'The Hobbit' }, { catalog, search: async () => [book()] })).kind, 'book');
  assert.equal((await identifyBook({ title: 'The Hobbit' }, { catalog: { search: async () => [book()] }, search: async () => { throw new ProviderError('network'); } })).kind, 'book');
  let calls = 0;
  await assert.rejects(identifyBook({ candidates: Array.from({ length: 100 }, (_, i) => ({ title: `Unknown ${i}` })) }, { search: async () => { calls++; return []; } }), /No confident/);
  assert.equal(calls, 4);
});
test('Open Library search uses encoded bounded queries and normalizes work rating without guessing series', async () => {
  const fetcher: typeof fetch = async input => { const url = new URL(String(input)); assert.equal(url.searchParams.get('title'), 'The Hobbit'); assert.equal(url.searchParams.get('author'), 'J.R.R. Tolkien'); assert.equal(url.searchParams.get('limit'), '12'); return new Response(JSON.stringify({ docs: [{ key: '/works/OL1W', title: 'The Hobbit', author_name: ['J.R.R. Tolkien'], isbn: ['bad', '9780547928227'], cover_i: 123, ratings_average: 4.2, ratings_count: 100 }] })); };
  const result = await openLibrarySearch({ title: 'The Hobbit', author: 'J.R.R. Tolkien' }, fetcher);
  assert.equal(result[0].isbn, undefined); assert.equal(result[0].ratings[0].average, 4.2); assert.equal(result[0].seriesStatus, 'unknown');
});
test('matching works across providers merge provenance, retain curated series and primary rating priority', () => {
  const local = { ...book(), isbn: '9780547928227', source: 'offline-catalog' as const, seriesStatus: 'standalone' as const, classificationSource: 'curated' as const, ratings: [{ provider: 'Open Library' as const, average: 4.1, stored: true }] };
  const hardcover = { ...book(), workId: '/works/OL1W', hardcoverId: '1', ratings: [{ provider: 'Hardcover' as const, average: 4.3 }] };
  const result = rankBooks([{ title: 'The Hobbit', author: 'J.R.R. Tolkien' }], [hardcover, local]);
  assert.equal(result?.kind, 'book');
  if (result?.kind === 'book') { assert.equal(result.book.isbn, local.isbn); assert.equal(result.book.seriesStatus, 'standalone'); assert.equal(result.book.ratings.length, 2); }
});


test('ISBN-10 converts only with a valid checksum, including X', () => {
  assert.equal(manualQuery('0-14-032872-6').isbn, '9780140328721');
  assert.equal(manualQuery('080442957X').isbn, '9780804429573');
  assert.throws(() => manualQuery('0804429571'), /valid/);
});
test('different work identifiers never combine ratings despite same title/author', () => {
  const a = { ...book(), ratings: [{ provider: 'Open Library' as const, average: 1 }] };
  const b = { ...book('The Hobbit', 'J.R.R. Tolkien', '2'), ratings: [{ provider: 'Open Library' as const, average: 5 }] };
  const result = rankBooks([{ title: 'The Hobbit' }], [a, b]);
  assert.equal(result?.kind, 'candidates');
  if (result?.kind === 'candidates') assert.deepEqual(result.books.map(b => b.ratings[0].average), [1, 5]);
});

test('validated local work is returned immediately for session enrichment', async () => {
  const expected = book('Warbreaker', 'Brandon Sanderson');
  let calls = 0;
  const result = await identifyBook({ origin: 'cover', candidates: [{ title: 'Brandon Sanderson' }, { title: 'Warbreaker', author: 'Brandon Sanderson' }] }, {
    catalog: { search: async () => [expected] },
    search: async query => { calls++; assert.equal(query.title, 'Warbreaker'); assert.equal(query.author, 'Brandon Sanderson'); return [{ ...expected, coverUrl: 'https://example.com/cover.jpg' }]; },
  });
  assert.equal(calls, 0);
  if (result.kind === 'book') assert.equal(result.book.title, 'Warbreaker');
  else assert.fail('Expected confident work');
});

test('manual title and author reach provider together before broad fallback', async () => {
  const result = await identifyBook({ title: 'The Hobbit', author: 'J.R.R. Tolkien', origin: 'manual' }, {
    search: async query => { assert.equal(query.author, 'J.R.R. Tolkien'); return [book()]; },
  });
  assert.equal(result.kind, 'book');
});
