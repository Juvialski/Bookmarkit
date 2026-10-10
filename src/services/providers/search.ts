import { ensureActive } from '../../recognition/session';
import { BookResult } from '../../models/book';
import { BookQuery } from '../../recognition/types';
import { normalizeText } from '../../recognition/normalization';
import { openLibrarySearch } from './openLibrarySearch';
import { googleBooksSearch } from './googleBooks';
import { centralSearch } from './centralCatalog';
export const providerSearch = async (query: BookQuery, signal?: AbortSignal): Promise<BookResult[]> => {
  const responses = await Promise.allSettled([centralSearch(query, signal), openLibrarySearch(query, fetch, signal), googleBooksSearch(query, fetch, signal)]);
  const books = responses.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (!books.length) {
    const failure = responses.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  return books;
};
export function createCachedSearch(search = providerSearch, now = Date.now) {
  const cache = new Map<string, { books: BookResult[]; expires: number }>();
  return async (query: BookQuery, signal?: AbortSignal) => {
    ensureActive(signal);
    const key = JSON.stringify([normalizeText(query.text || query.title || ''), normalizeText(query.author || '')]);
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.books;
    cache.delete(key);
    const books = await search(query, signal);
    ensureActive(signal);
    if (books.length && books.every(book => book.ratings.every(r => r.provider !== 'Google Books'))) {
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(key, { books, expires: now() + 300000 });
    }
    return books;
  };
}
