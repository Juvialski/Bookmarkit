import { BookResult, ProviderBook } from '../../models/book';
import { BookQuery } from '../../recognition/types';
import { normalizeText } from '../../recognition/normalization';
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
    return Array.isArray(books) ? books.filter(b => typeof b.title === 'string' && Array.isArray(b.authors) && Array.isArray(b.ratings)).slice(0, 12) : [];
  } catch { return []; } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export async function centralCatalog(isbn: string): Promise<ProviderBook | null> {
  const book = (await centralSearch({ isbn }))[0];
  return book ? { ...book, rating: book.ratings[0] || { provider: 'Open Library' } } : null;
}
