import { ensureActive } from '../../recognition/session';
import { BookResult } from '../../models/book';
import { BookQuery } from '../../recognition/types';
import { normalizeText } from '../../recognition/normalization';
import { openLibrarySearch } from './openLibrarySearch';
export const providerSearch = (query: BookQuery, signal?: AbortSignal) => openLibrarySearch(query, fetch, signal);
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
    if (books.length) {
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(key, { books, expires: now() + 300000 });
    }
    return books;
  };
}
