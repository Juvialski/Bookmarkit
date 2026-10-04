// Manual emulator contract fixture only. Never used by the production start command.
import { readFile } from 'node:fs/promises';
import { createBookServer } from '../src/index.mjs';
import { createHardcoverLookup } from '../src/hardcover.mjs';
const lookup = createHardcoverLookup({ token: 'mock-only', successTtlMs: 0, missTtlMs: 0,
  fetcher: async (_url, init) => {
    const mode = process.argv[2] ? (await readFile(process.argv[2], 'utf8')).trim() : 'success';
    if (mode === 'failure') return new Response('', { status: 503 });
    const isbn = JSON.parse(init.body).variables.isbn;
    return Response.json({ data: { editions: isbn === '9780765326355' ? [{ isbn_13: isbn, title: 'The Way of Kings',
      book: { id: 123, rating: 4.6, ratings_count: 12345, slug: 'the-way-of-kings',
        contributions: [{ contribution: 'Author', author: { name: 'Brandon Sanderson' } }],
        featured_book_series: { compilation: false, position: 1, series: { name: 'The Stormlight Archive' } } } }] : [] } });
  } });
createBookServer(lookup).listen(3001, '0.0.0.0', () => console.log('MOCK Hardcover proxy listening on 3001; fictional ratings.'));
