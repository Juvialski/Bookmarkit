import { isValidIsbn, normalizeIsbn } from './isbn';
import { BookResult } from '../models/book';
export function verifiedGoodreadsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/www\.goodreads\.com\/book\/show\/[1-9]\d{0,15}(?:[-.][A-Za-z0-9_%.-]+)?$/.test(value);
}
export function goodreadsReviewsUrl(book: BookResult) {
  const rating = book.ratings.find(r => r.provider === 'Goodreads' && r.verified && verifiedGoodreadsUrl(r.url));
  return rating?.url || goodreadsSearchUrl(book);
}
export function goodreadsSearchUrl(value: string | { isbn?: string; title: string; authors: string[] }) {
  const isbn = normalizeIsbn(typeof value === 'string' ? value : value.isbn || '');
  const query = isValidIsbn(isbn) ? isbn : typeof value !== 'string' ? `${value.title.trim()} ${value.authors.join(' ')}`.replace(/\s+/g, ' ').trim() : '';
  if (!query) throw new Error('Invalid ISBN.');
  return `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`;
}
