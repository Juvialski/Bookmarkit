import { ProviderBook } from '../../models/book';
import { Fetcher, json, object, ProviderError, rating, string, strings } from './shared';
import { seriesPosition } from '../../utils/classification';

function secureCover(value: unknown): string | undefined {
  try {
    const url = new URL(string(value) || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function normalizeHardcover(data: unknown, isbn: string): ProviderBook | null {
  const book = object(data);
  if (book.found === false) return null;
  if (book.found !== true || book.isbn !== isbn || !string(book.title) || !/^\d+$/.test(book.hardcoverId || '')) throw new ProviderError('malformed');
  const name = string(book.seriesName), position = seriesPosition(book.seriesPosition);
  const series = name && position;
  const url = string(book.url);
  return { isbn, title: book.title.trim(), authors: strings(book.authors), coverUrl: secureCover(book.coverUrl),
    hardcoverId: book.hardcoverId, hardcoverUrl: url && /^https:\/\/hardcover\.app\/books\/[a-z0-9-]+$/.test(url) ? url : undefined,
    seriesStatus: series ? 'series' : 'unknown', seriesName: series ? name : undefined, seriesPosition: series ? position : undefined,
    classificationSource: series ? 'hardcover' : 'unknown', classificationConfidence: series ? 'structured' : undefined,
    rating: { provider: 'Hardcover', ...rating(book.rating, book.ratingsCount) } };
}
export async function hardcover(isbn: string, fetcher: Fetcher = fetch, baseUrl = process.env.EXPO_PUBLIC_BOOK_API_BASE_URL || '') {
  if (!baseUrl.trim()) throw new ProviderError('unavailable');
  let base: URL;
  try { base = new URL(baseUrl.trim()); } catch { throw new ProviderError('unavailable'); }
  // HTTP is only for a local development backend; release configurations use HTTPS.
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['10.0.2.2', 'localhost', '127.0.0.1'].includes(base.hostname)))) throw new ProviderError('unavailable');
  return normalizeHardcover(await json(`${base.href.replace(/\/$/, '')}/api/books/${isbn}/hardcover`, fetcher, false, 2500), isbn);
}
