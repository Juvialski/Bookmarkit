import { BookResult } from '../models/book';
import { isValidIsbn, normalizeIsbn } from '../utils/isbn';
import { object, rating, string, strings } from './providers/shared';
import { mergeClassification, seriesPosition } from '../utils/classification';
import { verifiedGoodreadsUrl } from '../utils/goodreads';
import { BookCatalog } from '../recognition/types';
import { normalizeText } from '../recognition/normalization';
import { matchBook } from '../recognition/matching';
import { attachGoodreads } from './providers/goodreads';
import { normalizeHardcover, normalizeHardcoverWork } from './providers/hardcover';

export interface CatalogDatabase {
  getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null>;
}

export function normalizeLocalRecord(value: unknown, isbn: string, workOnly = false): BookResult | null {
  const row = object(value);
  if (row.isbn13 !== isbn || !string(row.title)) return null;
  let authors: unknown;
  try { authors = JSON.parse(row.authors); } catch { return null; }
  if (!Array.isArray(authors) || authors.some(a => typeof a !== 'string')) return null;
  const name = string(row.series_name), position = seriesPosition(row.series_position);
  const series = row.series_status === 'series' && name && position;
  const standalone = row.series_status === 'standalone' && row.classification_source === 'curated';
  const book: BookResult = { identity: workOnly ? 'work' : 'isbn', isbn: workOnly ? undefined : isbn, title: string(row.title)!, authors: strings(authors).map(a => a.trim()),
    workId: string(row.work_id), source: 'offline-catalog',
    goodreadsUrl: !workOnly && verifiedGoodreadsUrl(row.goodreads_url) ? row.goodreads_url : undefined,
    seriesStatus: series ? 'series' : standalone ? 'standalone' : 'unknown',
    seriesName: series ? name : undefined, seriesPosition: series ? position : undefined,
    classificationSource: row.classification_source === 'curated' ? 'curated' : series ? 'open-library' : 'unknown',
    classificationConfidence: row.classification_source === 'curated' ? 'curated' : series ? 'explicit' : undefined,
    ratings: [{ provider: 'Open Library', stored: true, ...rating(row.rating, row.rating_count) }], warnings: [] };
  try {
    const summaries = JSON.parse(row.goodreads_json || '[]');
    let enriched = Array.isArray(summaries) ? attachGoodreads(book, summaries) : book;
    let hardcoverRows: unknown;
    try { hardcoverRows = JSON.parse(row.hardcover_json || '[]'); } catch { hardcoverRows = []; }
    for (const record of Array.isArray(hardcoverRows) ? hardcoverRows : []) {
      try {
      if (!record || typeof record !== 'object') continue;
      if ((record.catalogWorkId || record.olWorkId) !== book.workId || record.verified !== true || record.ratingScope !== 'work') continue;
      const match = record.isbn === isbn && !workOnly ? normalizeHardcover(record, isbn) :
        normalizeHardcoverWork({ ...record, isbn: undefined, identity: 'work' }, { title: book.title, author: book.authors[0] });
      if (!match) continue;
      enriched = { ...enriched, ...mergeClassification([enriched, match]), ratings: [...enriched.ratings, { ...match.rating, stored: true }],
        hardcoverId: match.hardcoverId, hardcoverUrl: match.hardcoverUrl };
      } catch { /* An optional bad provider record never removes Goodreads. */ }
    }
    return { ...enriched, ratings: enriched.ratings.map(r => ({ ...r, stored: true })) };
  } catch { return book; }
}

export function createLocalCatalog(db: CatalogDatabase) {
  return async (value: string): Promise<BookResult | null> => {
    const isbn = normalizeIsbn(value);
    if (!isValidIsbn(isbn)) return null;
    const row = await db.getFirstAsync('SELECT * FROM books WHERE isbn13 = ?', isbn);
    return normalizeLocalRecord(row, isbn);
  };
}

export function createLocalSearch(db: CatalogDatabase & { getAllAsync<T>(sql: string, ...params: string[]): Promise<T[]> }): BookCatalog {
  return { async search(query) {
    if (query.isbn) { const book = await createLocalCatalog(db)(query.isbn); return book ? [book] : []; }
    const text = normalizeText(query.text || [query.title, query.author].filter(Boolean).join(' ')).slice(0, 240);
    if (!text) return [];
    const tokens = [...new Set(text.split(' '))].slice(0, 16);
    const placeholders = tokens.map(() => '?').join(',');
    const select = 'SELECT b.* FROM books b JOIN works w ON w.isbn13=b.isbn13';
    const ids = `(SELECT work_id FROM search_tokens WHERE token IN (${placeholders}) GROUP BY work_id ORDER BY COUNT(*) DESC, work_id LIMIT 80)`;
    let values = await db.getAllAsync<Record<string, unknown>>(`${select} WHERE w.id IN ${ids}`, ...tokens);
    try { values.push(...await db.getAllAsync<Record<string, unknown>>(`SELECT b.* FROM work_only_books b WHERE b.work_id IN ${ids}`, ...tokens)); } catch { /* Older v3 snapshots have no work-only table. */ }
    let books = values.flatMap(row => {
      const book = normalizeLocalRecord(row, String(row.isbn13), true);
      return book ? [{ ...book, isbn: undefined, identity: 'work' as const, ratings: book.ratings.filter(r => r.provider !== 'Goodreads' || r.scope === 'work') }] : [];
    }).filter(book => matchBook(query, book).score >= 0.75);
    if (!books.length && (query.title || query.text)) {
      const title = normalizeText(query.title || query.text || '').slice(0, 240);
      const grams = [...new Set(Array.from({ length: Math.max(0, title.length - 2) }, (_, i) => title.slice(i, i + 3)))].slice(0, 40);
      if (grams.length) {
        values = await db.getAllAsync<Record<string, unknown>>(`${select} WHERE w.id IN (SELECT work_id FROM search_grams WHERE gram IN (${grams.map(() => '?').join(',')}) GROUP BY work_id ORDER BY COUNT(*) DESC, work_id LIMIT 80)`, ...grams);
        books = values.flatMap(row => { const book = normalizeLocalRecord(row, String(row.isbn13), true); return book ? [{ ...book, isbn: undefined, identity: 'work' as const, ratings: book.ratings.filter(r => r.provider !== 'Goodreads' || r.scope === 'work') }] : []; }).filter(book => matchBook(query, book).score >= 0.75);
      }
    }
    return books;
  } };
}
