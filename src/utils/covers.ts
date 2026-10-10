import { BookResult } from '../models/book';
import { normalizeText, authorSimilarity } from '../recognition/normalization';
import { httpsCover } from '../services/providers/shared';

export function coverCandidates(...books: Pick<BookResult, 'coverUrl' | 'coverUrls'>[]): string[] {
  return [...new Set(books.flatMap(book => [book.coverUrl, ...(book.coverUrls || [])])
    .map(httpsCover).filter((url): url is string => !!url && !/(?:no[_-]?cover|placeholder|image[_-]?not[_-]?available)/i.test(url)))];
}

// ISBN matches refer to editions. Without an ISBN require a known work or an
// exact title AND matching author; a title alone cannot establish cover identity.
export function sameCoverBook(book: BookResult, candidate: BookResult): boolean {
  if (book.isbn) return book.isbn === candidate.isbn;
  if (book.workId && candidate.workId) return book.workId === candidate.workId;
  return normalizeText(book.title) === normalizeText(candidate.title) && book.authors.length > 0 &&
    book.authors.some(author => authorSimilarity(author, candidate.authors) >= 0.94);
}

export function nextCover(urls: string[], failed: ReadonlySet<string>, loaded?: string): string | undefined {
  return loaded && urls.includes(loaded) && !failed.has(loaded) ? loaded : urls.find(url => !failed.has(url));
}

export function coverIdentity(book: BookResult): string {
  return [book.isbn || book.workId || '', normalizeText(book.title), ...book.authors.map(normalizeText)].join('|');
}
