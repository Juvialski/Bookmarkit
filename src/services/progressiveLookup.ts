import { BookResult } from '../models/book';
import { lookupBook } from './bookLookup';
import { centralCatalog } from './providers/centralCatalog';
import { openLibrary } from './providers/openLibrary';
import { googleBooks } from './providers/googleBooks';
import { hardcover } from './providers/hardcover';
import { primaryRating } from '../utils/ratings';
export function createProgressiveLookup(local: (isbn: string) => Promise<BookResult | null>, providers = [centralCatalog, openLibrary, googleBooks, hardcover]) {
  const pending = new Map<string, Promise<BookResult>>();
  return {
    async lookup(isbn: string): Promise<BookResult> {
      const existing = pending.get(isbn); if (existing) return existing;
      const calls = providers.map(provider => provider(isbn));
      const stored = local(isbn).catch(() => null);
      const full = lookupBook(isbn, calls.map(call => () => call), () => stored);
      pending.set(isbn, full); void full.catch(() => {});
      // The same promises feed final enrichment; no second round of requests.
      const first = Promise.any(calls.map(async call => {
        const book = await call;
        if (!book || !primaryRating([book.rating])) throw new Error('No rated edition');
        return { ...book, ratings: [book.rating], warnings: book.warnings || [] } as BookResult;
      })).catch(() => full);
      const immediate = stored.then(book => book || first);
      try { return await Promise.race([first, immediate]); }
      finally { void full.finally(() => { const timer = setTimeout(() => { if (pending.get(isbn) === full) pending.delete(isbn); }, 15000); if (typeof timer === 'object' && 'unref' in timer) timer.unref(); }).catch(() => {}); }
    },
    async enrich(book: BookResult): Promise<BookResult> {
      return book.isbn && pending.has(book.isbn) ? pending.get(book.isbn)! : book;
    }
  };
}
