import { ensureActive } from '../../recognition/session';
import { BookResult } from '../../models/book';
import { BookQuery } from '../../recognition/types';
import { normalizeText } from '../../recognition/normalization';
import { openLibrarySearch } from './openLibrarySearch';
import { googleBooksSearch } from './googleBooks';
import { centralSearch } from './centralCatalog';
import { hardcoverSearch } from './hardcover';
export const providerSearch = async (query: BookQuery, signal?: AbortSignal): Promise<BookResult[]> => {
  const calls = [centralSearch(query, signal), openLibrarySearch(query, fetch, signal), googleBooksSearch(query, fetch, signal), hardcoverSearch(query, fetch, signal)];
  if (query.title && query.author) {
    try {
      return await Promise.any(calls.map(async call => {
        const books = await call;
        const exact = books.filter(book => normalizeText(book.title) === normalizeText(query.title!) &&
          book.authors.some(author => normalizeText(author) === normalizeText(query.author!)));
        if (!exact.length) throw new Error('No exact identity yet');
        return exact;
      }));
    } catch { /* Retain bounded broad results for the normal candidate picker. */ }
  }
  const responses = await Promise.allSettled(calls);
  const books = responses.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (!books.length) {
    const failure = responses.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  return books;
};
export function createCachedSearch(search = providerSearch, now = Date.now) {
  const cache = new Map<string, { books: BookResult[]; expires: number }>();
  const pending = new Map<string, Promise<BookResult[]>>();
  return async (query: BookQuery, signal?: AbortSignal) => {
    ensureActive(signal);
    const key = JSON.stringify([normalizeText(query.text || query.title || ''), normalizeText(query.author || '')]);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.books;
    cache.delete(key);
    const existing = pending.get(key);
    if (existing) { const books = await existing; ensureActive(signal); return books; }
    // Only share calls without caller cancellation. A cancelled scan must not
    // poison another independently active caller's request.
    const operation = search(query, signal);
    if (!signal) pending.set(key, operation);
    let books: BookResult[];
    try { books = await operation; } finally { if (pending.get(key) === operation) pending.delete(key); }
    ensureActive(signal);
    if (books.length && books.every(book => book.ratings.every(r => r.provider !== 'Google Books'))) {
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(key, { books, expires: now() + 300000 });
    }
    return books;
  };
}
