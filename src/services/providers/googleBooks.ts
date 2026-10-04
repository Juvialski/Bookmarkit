import { ProviderBook } from '../../models/book';
import { Fetcher, json, object, rating, string, strings, httpsCover, ProviderError } from './shared';
export function normalizeGoogleBooks(data: unknown, isbn: string): ProviderBook | null {
  const items = object(data).items;
  if (!Array.isArray(items)) {
    if (object(data).totalItems === 0) return null;
    throw new ProviderError('malformed');
  }
  const item = items.find(item => { const info = object(object(item).volumeInfo); return Array.isArray(info.industryIdentifiers) && info.industryIdentifiers.some((id: unknown) => object(id).identifier === isbn); });
  if (!item) return null;
  const info = object(object(item).volumeInfo);
  const title = string(info.title);
  if (!title) return null;
  const images = object(info.imageLinks);
  const cover = httpsCover(images.thumbnail) || httpsCover(images.smallThumbnail);
  return { isbn, title, authors: strings(info.authors), coverUrl: cover, seriesStatus: 'unknown', rating: { provider: 'Google Books', ...rating(info.averageRating, info.ratingsCount) } };
}
export async function googleBooks(isbn: string, fetcher: Fetcher = fetch, apiKey = process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY, delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=10${apiKey?.trim() ? `&key=${encodeURIComponent(apiKey.trim())}` : ''}`;
  // Two attempts maximum; never retry network, timeout or invalid payload errors.
  for (let attempt = 0; ; attempt++) {
    try { return normalizeGoogleBooks(await json(url, fetcher, false, 5000), isbn); }
    catch (error) {
      if (attempt || !(error instanceof ProviderError) || !['rate-limit', 'server'].includes(error.kind)) throw error;
      await delay(500);
    }
  }
}
