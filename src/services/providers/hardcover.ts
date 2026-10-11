import { BookResult, ProviderBook } from '../../models/book';
import { Fetcher, json, object, ProviderError, rating, string, strings } from './shared';
import { seriesPosition } from '../../utils/classification';
import { BookQuery } from '../../recognition/types';
import { normalizeText } from '../../recognition/normalization';
import { CATALOG_KEY, SUPABASE_URL } from './centralCatalog';

const configuredBase = () => process.env.EXPO_PUBLIC_HARDCOVER_ENABLED === '1'
  ? `${SUPABASE_URL}/functions/v1/hardcover` : process.env.EXPO_PUBLIC_BOOK_API_BASE_URL || '';

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
    rating: { provider: 'Hardcover', ...rating(book.rating, book.ratingsCount), verified: book.verified === true,
      scope: 'work', retrievedAt: string(book.retrievedAt) } };
}
export function normalizeHardcoverWork(data: unknown, query: BookQuery): ProviderBook | null {
  const book = object(data);
  if (book.found === false) return null;
  if (!query.title || !query.author || book.identity !== 'work' || book.verified !== true || book.ratingScope !== 'work' ||
    book.isbn || normalizeText(book.title || '') !== normalizeText(query.title) ||
    normalizeText(strings(book.authors)[0] || '') !== normalizeText(query.author)) throw new ProviderError('malformed');
  const normalized = normalizeHardcover({ ...book, isbn: '9780439023481' }, '9780439023481');
  if (!normalized) return null;
  return { ...normalized, isbn: undefined, identity: 'work' };
}
async function edgeQuery(query: object, fetcher: Fetcher, base: string, signal?: AbortSignal) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetcher(base, { method: 'POST', headers: { apikey: CATALOG_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(query), signal: controller.signal });
    if (!response.ok) throw new ProviderError(response.status === 429 ? 'rate-limit' : 'unavailable');
    const length = Number(response.headers.get('content-length'));
    if (length > 65536) throw new ProviderError('malformed');
    const text = await response.text();
    if (text.length > 65536) throw new ProviderError('malformed');
    return JSON.parse(text);
  } catch (error) { if (controller.signal.aborted) throw new ProviderError('timeout'); if (error instanceof ProviderError) throw error; throw new ProviderError('network'); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
const pendingSearches = new Map<string, {signal?: AbortSignal; request: Promise<BookResult[]>}>();
export async function hardcoverSearch(query: BookQuery, fetcher: Fetcher = fetch, signal?: AbortSignal, baseUrl = configuredBase()): Promise<BookResult[]> {
  if (!query.title || !query.author || !baseUrl.endsWith('/functions/v1/hardcover')) return [];
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ProviderError('unavailable');
  const key = JSON.stringify([baseUrl, normalizeText(query.title), normalizeText(query.author)]);
  const existing = pendingSearches.get(key);
  if (fetcher === fetch && existing && existing.signal === signal) return existing.request;
  const request = (async () => {
    const book = normalizeHardcoverWork(await edgeQuery({ title: query.title, author: query.author }, fetcher, baseUrl, signal), query);
    return book ? [{ ...book, ratings: [book.rating], warnings: [] }] : [];
  })();
  if (fetcher === fetch) pendingSearches.set(key, { signal, request });
  try { return await request; } finally { if (pendingSearches.get(key)?.request === request) pendingSearches.delete(key); }
}
export async function hardcover(isbn: string, fetcher: Fetcher = fetch, baseUrl = configuredBase()) {
  if (!baseUrl.trim()) throw new ProviderError('unavailable');
  let base: URL;
  try { base = new URL(baseUrl.trim()); } catch { throw new ProviderError('unavailable'); }
  // HTTP is only for a local development backend; release configurations use HTTPS.
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['10.0.2.2', 'localhost', '127.0.0.1'].includes(base.hostname)))) throw new ProviderError('unavailable');
  if (base.pathname.endsWith('/functions/v1/hardcover')) return normalizeHardcover(await edgeQuery({ isbn }, fetcher, base.href), isbn);
  return normalizeHardcover(await json(`${base.href.replace(/\/$/, '')}/api/books/${isbn}/hardcover`, fetcher, false, 2500), isbn);
}
