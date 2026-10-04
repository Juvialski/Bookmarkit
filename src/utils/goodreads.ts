import { isValidIsbn, normalizeIsbn } from './isbn';
export function goodreadsSearchUrl(value: string) {
  const isbn = normalizeIsbn(value);
  if (!isValidIsbn(isbn)) throw new Error('Invalid ISBN.');
  return `https://www.goodreads.com/search?q=${encodeURIComponent(isbn)}&search_type=books`;
}
