import { ProviderBook } from '../../models/book';
import { Fetcher, json, object, rating, string, strings } from './shared';
export function normalizeGoogleBooks(data: unknown, isbn: string): ProviderBook | null {
  const items = object(data).items;
  if (!Array.isArray(items)) return null;
  const item = items.find(item => { const info = object(object(item).volumeInfo); return Array.isArray(info.industryIdentifiers) && info.industryIdentifiers.some((id: unknown) => object(id).identifier === isbn); });
  if (!item) return null;
  const info = object(object(item).volumeInfo);
  const title = string(info.title);
  if (!title) return null;
  const images = object(info.imageLinks);
  const cover = string(images.thumbnail) || string(images.smallThumbnail);
  return { isbn, title, authors: strings(info.authors), coverUrl: cover?.replace(/^http:/, 'https:'), seriesStatus: 'unknown', rating: { provider: 'Google Books', ...rating(info.averageRating, info.ratingsCount) } };
}
export async function googleBooks(isbn: string, fetcher: Fetcher = fetch) {
  return normalizeGoogleBooks(await json(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=10`, fetcher), isbn);
}
