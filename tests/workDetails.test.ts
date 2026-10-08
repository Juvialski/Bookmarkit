import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkEnricher } from '../src/services/providers/workDetails';
import { BookResult } from '../src/models/book';
const book: BookResult = { title: 'Example', authors: [], workId: '/works/OL1W', seriesStatus: 'unknown', ratings: [{ provider: 'Open Library', average: 4 }], warnings: [] };
test('selected work gets only consistent explicit series; ratings remain unchanged', async () => {
  let calls = 0;
  const enrich = createWorkEnricher(async input => { calls++; assert.equal(String(input), 'https://openlibrary.org/works/OL1W.json'); return new Response(JSON.stringify({ key: book.workId, series: ['Example Series #2'] })); });
  const result = await enrich(book);
  assert.equal(result.seriesName, 'Example Series'); assert.equal(result.seriesPosition, '2');
  assert.deepEqual(result.ratings, book.ratings); assert.equal(result.isbn, undefined);
  await enrich(book); assert.equal(calls, 1);
});
test('wrong work, outages, missing metadata never manufacture standalone or lose ratings', async () => {
  for (const payload of [{ key: '/works/OL2W', series: ['Other #1'] }, { key: book.workId }, { key: book.workId, series: ['Conflicting #1', 'Conflicting #2'] }]) {
    const result = await createWorkEnricher(async () => new Response(JSON.stringify(payload)))(book);
    assert.equal(result.seriesStatus, 'unknown'); assert.deepEqual(result.ratings, book.ratings);
  }
  assert.deepEqual(await createWorkEnricher(async () => { throw Error('offline'); })(book), book);
});
