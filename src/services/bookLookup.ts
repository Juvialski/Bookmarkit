import { BookResult } from '../models/book';
import { isValidIsbn, normalizeIsbn } from '../utils/isbn';
import { googleBooks } from './providers/googleBooks';
import { openLibrary } from './providers/openLibrary';
export async function lookupBook(value: string, providers = [googleBooks, openLibrary]): Promise<BookResult> {
  const isbn = normalizeIsbn(value);
  if (!isValidIsbn(isbn)) throw new Error('Enter a valid book ISBN-13 beginning with 978 or 979.');
  const responses = await Promise.allSettled(providers.map(provider => provider(isbn)));
  const books = responses.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);
  if (!books.length) throw new Error(responses.some(r => r.status === 'rejected') ? 'Book lookup could not complete. Check your connection and try again.' : 'No book found for this ISBN. Try another book.');
  const first = books[0], series = books.find(b => b.seriesStatus === 'series');
  const names = ['Google Books', 'Open Library'] as const;
  return { isbn, title: first.title, workId: books.find(b => b.workId)?.workId,
    authors: books.find(b => b.authors.length)?.authors || [], coverUrl: books.find(b => b.coverUrl)?.coverUrl,
    seriesStatus: series ? 'series' : 'unknown', seriesName: series?.seriesName, seriesPosition: series?.seriesPosition,
    ratings: names.map((provider, i) => { const r = responses[i]; return r?.status === 'fulfilled' && r.value ? r.value.rating : { provider, unavailable: r?.status === 'rejected' }; }),
    warnings: responses.flatMap((r, i) => r.status === 'rejected' ? [`${names[i]} could not be loaded.`] : r.value?.warnings || []) };
}
