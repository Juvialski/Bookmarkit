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
