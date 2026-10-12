import { BookResult } from '../models/book';

type Classification = Pick<BookResult, 'seriesStatus' | 'seriesName' | 'seriesPosition' | 'classificationSource' | 'classificationConfidence'>;
export const unknownClassification: Classification = { seriesStatus: 'unknown', classificationSource: 'unknown' };
export function seriesPosition(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) return undefined;
  return String(Number(value));
}
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
export function mergeClassification(books: Classification[]): Classification {
  const known = books.filter(b => b.seriesStatus === 'standalone' || (b.seriesStatus === 'series' && b.seriesName?.trim() && seriesPosition(b.seriesPosition)));
  if (!known.length) return unknownClassification;
  const first = known[0];
  if (known.some(b => b.seriesStatus !== first.seriesStatus || (b.seriesStatus === 'series' && (nameKey(b.seriesName!) !== nameKey(first.seriesName!) || seriesPosition(b.seriesPosition) !== seriesPosition(first.seriesPosition))))) return unknownClassification;
  return { seriesStatus: first.seriesStatus, seriesName: first.seriesName, seriesPosition: seriesPosition(first.seriesPosition), classificationSource: first.classificationSource, classificationConfidence: first.classificationConfidence };
}


// Reviewed author evidence, not an inference from Hardcover's numbered series.
// State of the Sanderson 2025: Warbreaker sequels remain to be written eventually.
export function reviewedClassification(book: BookResult): BookResult {
  if (book.title.trim().toLowerCase() === 'warbreaker' && book.authors.some(a => a.trim().toLowerCase() === 'brandon sanderson')) {
    return { ...book, seriesStatus: 'unknown', seriesName: undefined, seriesPosition: undefined,
      plannedSequel: true, classificationSource: 'curated', classificationConfidence: 'curated',
      classificationEvidence: 'https://www.brandonsanderson.com/blogs/blog/state-of-the-sanderson-2025' };
  }
  return book;
}
