import { BookResult } from '../models/book';
import { isValidIsbn, normalizeIsbn } from '../utils/isbn';
import { hardcover } from './providers/hardcover';
import { openLibrary } from './providers/openLibrary';
import { httpsCover, ProviderError } from './providers/shared';
export async function lookupBook(value: string, providers = [hardcover, openLibrary], local?: (isbn: string) => Promise<BookResult | null>): Promise<BookResult> {
  const isbn = normalizeIsbn(value);
  if (!isValidIsbn(isbn)) throw new Error('Enter a valid book ISBN-13 beginning with 978 or 979.');
  const responses = await Promise.allSettled(providers.map(provider => provider(isbn)));
  const books = responses.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);
  if (!books.length) {
    if (local) {
      try {
        const stored = await local(isbn);
        if (stored) return stored;
      } catch {
        throw new Error('Book lookup unavailable. The offline catalog could not be read. Try again.');
      }
    }
    const errors = responses.flatMap(r => r.status === 'rejected' ? [r.reason] : []);
    if (!errors.length) throw new Error('No book found for this ISBN. Try another book.');
    if (errors.every(e => e instanceof ProviderError && e.kind === 'network')) throw new Error('Internet unavailable. This ISBN is not in the offline catalog. Try another book or reconnect.');
    if (errors.some(e => e instanceof ProviderError && e.kind === 'rate-limit')) throw new Error('Book lookup is busy. This ISBN is not in the offline catalog. Try again shortly.');
    throw new Error('Book services are unavailable and this ISBN is not in the offline catalog. Check your connection or try another book.');
  }
  // Fixed precedence: exact Hardcover ISBN edition, then Open Library ISBN edition.
  const first = books[0];
  const seriesBooks = books.filter(b => b.seriesStatus === 'series' && b.seriesName && b.seriesPosition);
  const series = seriesBooks.every(b => b.seriesName === seriesBooks[0]?.seriesName && b.seriesPosition === seriesBooks[0]?.seriesPosition) ? seriesBooks[0] : undefined;
  const names = ['Hardcover', 'Open Library'] as const;
  return { isbn, title: first.title, workId: books.find(b => b.workId)?.workId,
    hardcoverId: books.find(b => b.hardcoverId)?.hardcoverId, hardcoverUrl: books.find(b => b.hardcoverUrl)?.hardcoverUrl,
    incomplete: responses.some(r => r.status === 'rejected') || books.some(b => b.rating.unavailable),
    authors: books.find(b => b.authors.length)?.authors || [], coverUrl: books.map(b => httpsCover(b.coverUrl)).find(Boolean),
    seriesStatus: series ? 'series' : 'unknown', seriesName: series?.seriesName, seriesPosition: series?.seriesPosition,
    ratings: names.flatMap((_provider, i) => { const r = responses[i]; return r?.status === 'fulfilled' && r.value ? [r.value.rating] : []; }),
    // Optional provider outages are quiet when another source identifies the book.
    warnings: books.flatMap(b => b.warnings || []) };
}

export function createCachedLookup(lookup: (isbn: string) => Promise<BookResult>, now = Date.now, maxSize = 20, ttlMs = 5 * 60 * 1000) {
  const cache = new Map<string, { book: BookResult; expires: number }>();
  return async (value: string): Promise<BookResult> => {
    const isbn = normalizeIsbn(value);
    if (!isValidIsbn(isbn)) throw new Error('Enter a valid book ISBN-13 beginning with 978 or 979.');
    const hit = cache.get(isbn);
    if (hit && hit.expires > now()) return hit.book;
    cache.delete(isbn);
    const book = await lookup(isbn);
    // Retain partial successes briefly to avoid hammering a busy provider.
    for (const [key, value] of cache) if (value.expires <= now()) cache.delete(key);
    if (cache.size >= maxSize) cache.delete(cache.keys().next().value!);
    cache.set(isbn, { book, expires: now() + (book.source === 'offline-catalog' || book.incomplete || book.warnings.length ? Math.min(ttlMs, 30000) : ttlMs) });
    return book;
  };
}
export const lookupBookForSession = createCachedLookup(lookupBook);
