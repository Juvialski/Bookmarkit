import { BookResult } from '../models/book';
import { coverCandidates, sameCoverBook } from '../utils/covers';
import { mergeClassification } from '../utils/classification';
import { BookQuery } from '../recognition/types';
import { providerSearch } from './providers/search';
import { createWorkEnricher } from './providers/workDetails';
import { hardcoverSearch } from './providers/hardcover';

export function mergeEnrichment(book: BookResult, matches: BookResult[]): BookResult {
  const trusted = matches.filter(candidate => sameCoverBook(book, candidate));
  // Keep existing identity/text and a usable image. Prefer Open Library among
  // new candidates, but retain every trusted alternative for native load errors.
  const ordered = [...trusted].sort((a, b) => Number(!coverCandidates(a)[0]?.includes('covers.openlibrary.org')) - Number(!coverCandidates(b)[0]?.includes('covers.openlibrary.org')));
  const links = trusted.filter(candidate => !!book.isbn && candidate.isbn === book.isbn);
  const coverUrls = coverCandidates(book, ...ordered);
  const online = trusted.flatMap(candidate => candidate.ratings).filter(r => !r.stored && !r.unavailable && r.average !== undefined);
  const ratings = [...online, ...book.ratings.filter(r => !online.some(o => o.provider === r.provider))];
  return { ...book, goodreadsId: book.goodreadsId || links.find(b => b.goodreadsId)?.goodreadsId, goodreadsUrl: book.goodreadsUrl || links.find(b => b.goodreadsUrl)?.goodreadsUrl, workId: book.workId || trusted.find(b => b.workId)?.workId,
    hardcoverId: book.hardcoverId || trusted.find(b => b.hardcoverId)?.hardcoverId,
    hardcoverUrl: book.hardcoverUrl || trusted.find(b => b.hardcoverUrl)?.hardcoverUrl,
    coverUrl: coverUrls[0], coverUrls, ratings, ...mergeClassification([book, ...trusted]) };
}

export function createBookEnricher(
  isbnEnrich: (book: BookResult) => Promise<BookResult>,
  search: (query: BookQuery, signal?: AbortSignal) => Promise<BookResult[]> = providerSearch,
  work = createWorkEnricher(),
) {
  return async (book: BookResult, signal?: AbortSignal): Promise<BookResult> => {
    try {
      const query = { title: book.title, author: book.authors[0] };
      const matches = book.isbn ? [await isbnEnrich(book)] : (await Promise.allSettled([
        search(query, signal), hardcoverSearch(query, fetch, signal),
      ])).flatMap(response => response.status === 'fulfilled' ? response.value : []);
      if (signal?.aborted) return book;
      if (!matches.length) return book;
      return await work(mergeEnrichment(book, matches), signal);
    } catch { return book; }
  };
}
