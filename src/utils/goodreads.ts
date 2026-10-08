import { isValidIsbn, normalizeIsbn } from './isbn';
export function goodreadsSearchUrl(value: string | { isbn?: string; title: string; authors: string[] }) {
  const isbn = normalizeIsbn(typeof value === 'string' ? value : value.isbn || '');
  const query = isValidIsbn(isbn) ? isbn : typeof value !== 'string' ? `${value.title.trim()} ${value.authors.join(' ')}`.replace(/\s+/g, ' ').trim() : '';
  if (!query) throw new Error('Invalid ISBN.');
  return `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`;
}
