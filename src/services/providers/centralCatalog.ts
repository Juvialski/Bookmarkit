import { BookResult, ProviderBook } from '../../models/book';
import { BookQuery } from '../../recognition/types';
import { normalizeText } from '../../recognition/normalization';
import { attachGoodreads } from './goodreads';
import { primaryRating } from '../../utils/ratings';
export const SUPABASE_URL = 'https://xxijxuekfsxuzhnujqem.supabase.co';
// Public, read-only publishable key. Writes are denied by grants and RLS.
export const CATALOG_KEY = 'sb_publishable_wzIGwfmaZRYy8GmHZIq41Q_MNjHxhtX';
export async function centralSearch(query: BookQuery, signal?: AbortSignal): Promise<BookResult[]> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1800);
  const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_catalog`, { method: 'POST', headers: { apikey: CATALOG_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ isbn: query.isbn || null, query: normalizeText(query.text || [query.title, query.author].filter(Boolean).join(' ')) || null }), signal: controller.signal });
    if (!response.ok) return [];
    const books = await response.json();
    const matches: BookResult[] = Array.isArray(books) ? books.filter(b => typeof b.title === 'string' && Array.isArray(b.authors) && Array.isArray(b.ratings)).slice(0, 12) : [];
    const works = [...new Set(matches.map(b => b.workId).filter((id): id is string => !!id && /^\/works\/OL\d+W$/.test(id)))];
    if (!works.length) return matches;
    // Read only the existing cache, under the same total deadline; no crawl on the phone.
    try {
      const cached = await fetch(`${SUPABASE_URL}/rest/v1/goodreads_summaries?select=*&work_id=in.(${works.map(encodeURIComponent).join(',')})&order=retrieved_at.desc&limit=100`, { headers: { apikey: CATALOG_KEY }, signal: controller.signal });
      if (!cached.ok) return matches;
      const rows = await cached.json();
      return Array.isArray(rows) ? matches.map(book => attachGoodreads(book, rows)) : matches;
    } catch { return matches; }
  } catch { return []; } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export async function centralCatalog(isbn: string): Promise<ProviderBook | null> {
  const book = (await centralSearch({ isbn }))[0];
  return book ? { ...book, rating: primaryRating(book.ratings) || { provider: 'Open Library' } } : null;
}
