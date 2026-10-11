import { BookResult } from '../models/book';
import { lookupBook } from './bookLookup';
import { centralCatalog } from './providers/centralCatalog';
import { openLibrary } from './providers/openLibrary';
import { googleBooks } from './providers/googleBooks';
import { hardcover } from './providers/hardcover';
export function createProgressiveLookup(local: (isbn: string) => Promise<BookResult | null>, providers = [centralCatalog, openLibrary, googleBooks, hardcover]) {
  const pending = new Map<string, Promise<BookResult>>();
  const completed = new Map<string, {book: BookResult; expires: number}>();
  return {
    async lookup(isbn: string): Promise<BookResult> {
      const cached = completed.get(isbn);
      if (cached && cached.expires > Date.now()) return cached.book;
      completed.delete(isbn);
      const existing = pending.get(isbn); if (existing) return existing;
      const calls = providers.map(provider => Promise.resolve().then(() => provider(isbn)));
      const stored = local(isbn).catch(() => null);
      const full = lookupBook(isbn, calls.map(call => () => call), () => stored);
      pending.set(isbn, full); void full.catch(() => {});
      // The same promises feed final enrichment; no second round of requests.
      const first = Promise.any(calls.map(async call => {
        const book = await call;
        if (!book || (book.isbn && book.isbn !== isbn) || !book.title.trim()) throw new Error('No identified edition');
        return { ...book, ratings: [book.rating], warnings: book.warnings || [] } as BookResult;
      })).catch(() => full);
      const immediate = stored.then(book => book || first);
      try { return await Promise.race([first, immediate]); }
      finally { void full.then(book => {
        if (completed.size >= 20) completed.delete(completed.keys().next().value!);
        completed.set(isbn, { book, expires: Date.now() + (book.incomplete ? 30000 : 300000) });
      }).finally(() => { if (pending.get(isbn) === full) pending.delete(isbn); }).catch(() => {}); }
    },
    async enrich(book: BookResult): Promise<BookResult> {
      if (!book.isbn) return book;
      const cached = completed.get(book.isbn);
      return pending.get(book.isbn) || (cached && cached.expires > Date.now() ? cached.book : undefined) || lookupBook(book.isbn, providers, local).catch(() => book);
    }
  };
}
