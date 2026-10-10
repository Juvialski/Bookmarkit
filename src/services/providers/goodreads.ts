import { BookResult, Rating } from '../../models/book';
import { verifiedGoodreadsUrl } from '../../utils/goodreads';

export function goodreadsRating(row: Record<string, unknown>, book: Pick<BookResult, 'isbn' | 'workId'>): Rating | undefined {
  const score = row.average, count = row.rating_count;
  if (row.status !== 'verified' || row.work_id !== book.workId ||
    (row.rating_scope !== 'work' && (row.rating_scope !== 'edition' || !book.isbn || row.isbn13 !== book.isbn)) ||
    (row.match_confidence !== 'exact_isbn' && row.match_confidence !== 'title_author') ||
    typeof score !== 'number' || !Number.isFinite(score) || score <= 0 || score > 5 ||
    typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0 || !verifiedGoodreadsUrl(row.url) ||
    typeof row.retrieved_at !== 'string' || !Number.isFinite(Date.parse(row.retrieved_at))) return undefined;
  return { provider: 'Goodreads', average: score, count, verified: true, url: row.url, scope: row.rating_scope as 'work' | 'edition', retrievedAt: row.retrieved_at };
}

export function attachGoodreads(book: BookResult, rows: Record<string, unknown>[]): BookResult {
  const matches = rows.map(row => ({ row, rating: goodreadsRating(row, book) })).filter(m => m.rating)
    .sort((a, b) => Number(b.row.isbn13 === book.isbn) - Number(a.row.isbn13 === book.isbn) || Date.parse(b.rating!.retrievedAt!) - Date.parse(a.rating!.retrievedAt!));
  if (!matches.length) return book;
  const { row, rating } = matches[0];
  const series = book.seriesStatus === 'unknown' && typeof row.series_name === 'string' && row.series_name.trim() &&
    typeof row.series_position === 'string' && /^\d+(?:\.\d+)?$/.test(row.series_position) && Number(row.series_position) > 0;
  return { ...book, ratings: [rating!, ...book.ratings.filter(r => r.provider !== 'Goodreads')],
    ...(series ? { seriesStatus: 'series', seriesName: row.series_name as string, seriesPosition: row.series_position as string } : {}) };
}
