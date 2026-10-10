import { BookResult } from '../models/book';
import { coverCandidates, sameCoverBook } from '../utils/covers';
import { mergeClassification } from '../utils/classification';
import { BookQuery } from '../recognition/types';
import { providerSearch } from './providers/search';
import { createWorkEnricher } from './providers/workDetails';

export function mergeEnrichment(book: BookResult, matches: BookResult[]): BookResult {
  const trusted = matches.filter(candidate => sameCoverBook(book, candidate));
  // Keep existing identity/text and a usable image. Prefer Open Library among
  // new candidates, but retain every trusted alternative for native load errors.
  const ordered = [...trusted].sort((a, b) => Number(!coverCandidates(a)[0]?.includes('covers.openlibrary.org')) - Number(!coverCandidates(b)[0]?.includes('covers.openlibrary.org')));
  const coverUrls = coverCandidates(book, ...ordered);
  const online = trusted.flatMap(candidate => candidate.ratings).filter(r => !r.stored && !r.unavailable && r.average !== undefined);
  const ratings = [...online, ...book.ratings.filter(r => !online.some(o => o.provider === r.provider))];
  return { ...book, workId: book.workId || trusted.find(b => b.workId)?.workId,
    coverUrl: coverUrls[0], coverUrls, ratings, ...mergeClassification([book, ...trusted]) };
}

export function createBookEnricher(
  isbnEnrich: (book: BookResult) => Promise<BookResult>,
  search: (query: BookQuery, signal?: AbortSignal) => Promise<BookResult[]> = providerSearch,
  work = createWorkEnricher(),
) {
  return async (book: BookResult, signal?: AbortSignal): Promise<BookResult> => {
    try {
      const matches = book.isbn ? [await isbnEnrich(book)] : await search({ title: book.title, author: book.authors[0] }, signal);
      if (signal?.aborted) return book;
      return await work(mergeEnrichment(book, matches), signal);
    } catch { return book; }
  };
}
