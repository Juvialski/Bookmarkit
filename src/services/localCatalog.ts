import { BookResult } from '../models/book';
import { isValidIsbn, normalizeIsbn } from '../utils/isbn';
import { object, rating, string, strings } from './providers/shared';
import { seriesPosition } from '../utils/classification';

export interface CatalogDatabase {
  getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null>;
}

export function normalizeLocalRecord(value: unknown, isbn: string): BookResult | null {
  const row = object(value);
  if (row.isbn13 !== isbn || !string(row.title)) return null;
  let authors: unknown;
  try { authors = JSON.parse(row.authors); } catch { return null; }
  if (!Array.isArray(authors) || authors.some(a => typeof a !== 'string')) return null;
  const name = string(row.series_name), position = seriesPosition(row.series_position);
  const series = row.series_status === 'series' && name && position;
  const standalone = row.series_status === 'standalone' && row.classification_source === 'curated';
  return { isbn, title: string(row.title)!, authors: strings(authors).map(a => a.trim()),
    workId: string(row.work_id), source: 'offline-catalog',
    seriesStatus: series ? 'series' : standalone ? 'standalone' : 'unknown',
    seriesName: series ? name : undefined, seriesPosition: series ? position : undefined,
    classificationSource: row.classification_source === 'curated' ? 'curated' : series ? 'open-library' : 'unknown',
    classificationConfidence: row.classification_source === 'curated' ? 'curated' : series ? 'explicit' : undefined,
    ratings: [{ provider: 'Open Library', stored: true, ...rating(row.rating, row.rating_count) }], warnings: [] };
}

export function createLocalCatalog(db: CatalogDatabase) {
  return async (value: string): Promise<BookResult | null> => {
    const isbn = normalizeIsbn(value);
    if (!isValidIsbn(isbn)) return null;
    const row = await db.getFirstAsync('SELECT * FROM books WHERE isbn13 = ?', isbn);
    return normalizeLocalRecord(row, isbn);
  };
}
