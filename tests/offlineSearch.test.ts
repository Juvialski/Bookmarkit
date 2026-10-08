import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSearch } from '../src/services/localCatalog';
import { identifyBook } from '../src/services/identifyBook';
const database = new DatabaseSync('assets/catalog-v3.db', { readOnly: true });
const catalog = createLocalSearch({
  async getFirstAsync<T>(sql: string, ...params: string[]) { return (database.prepare(sql).get(...params) || null) as T | null; },
  async getAllAsync<T>(sql: string, ...params: string[]) { return database.prepare(sql).all(...params) as T[]; },
});
test('real SQLite index resolves title/author, reversed free text and fuzzy title offline', async () => {
  for (const query of [{ title: 'The Way of Kings', author: 'Brandon Sanderson' }, { text: 'Brandon Sanderson Way of Kings' }, { title: 'The Hobb1t' }]) {
    const result = await identifyBook(query, { catalog, online: async () => false });
    const books = result.kind === 'book' ? [result.book] : result.books;
    assert.ok(books.some(b => /Way of Kings|Hobbit/.test(b.title)));
    assert.equal(books[0].isbn, undefined);
    assert.equal(books[0].ratings[0].stored, true);
  }
});
test('real offline ISBN-10 regression and unknown title are distinct', async () => {
  const result = await identifyBook({ isbn: '0140328726' }, { catalog, online: async () => false });
  assert.equal(result.kind, 'book');
  if (result.kind === 'book') assert.equal(result.book.isbn, '9780140328721');
  await assert.rejects(identifyBook({ title: 'Unmapped Galactic Handbook' }, { catalog, online: async () => false }), /not in the offline catalog/);
});
