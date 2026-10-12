import { BookResult, Rating } from '../models/book';
import { BookQuery } from '../recognition/types';
import { normalizeText } from '../recognition/normalization';
import { matchBook } from '../recognition/matching';
import { isValidIsbn, normalizeIsbn } from '../utils/isbn';
import { mergeClassification } from '../utils/classification';
import { verifiedGoodreadsUrl } from '../utils/goodreads';

export interface CacheDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: string[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: string[]): Promise<T[]>;
}
export const personalSchema = `PRAGMA journal_mode=WAL;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS personal_books (identity TEXT PRIMARY KEY, isbn TEXT, metadata TEXT NOT NULL, retrieved_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS personal_isbn ON personal_books(isbn);
PRAGMA user_version=1;
COMMIT;`;

// Edition identities never collapse into work identities, even with identical text.
export function cacheIdentity(book: BookResult): string | null {
  if (!book.title.trim() || !Array.isArray(book.authors)) return null;
  if (book.isbn) return isValidIsbn(normalizeIsbn(book.isbn)) ? `isbn:${normalizeIsbn(book.isbn)}` : null;
  if (book.workId && /^\/works\/OL\d+W$/.test(book.workId)) return `ol:${book.workId}`;
  if (book.hardcoverId && /^\d+$/.test(book.hardcoverId)) return `hc:${book.hardcoverId}`;
  if (!book.authors.length) return null;
  return `text:${JSON.stringify([normalizeText(book.title), book.authors.map(normalizeText).sort()])}`;
}
export function reusableBook(book: BookResult, previous?: BookResult): BookResult {
  const usable = book.ratings.filter(r => !r.unavailable && r.average !== undefined && Number.isFinite(r.average) && r.average > 0 && r.average <= 5
    && (r.count === undefined || (Number.isSafeInteger(r.count) && r.count >= 0)) && (r.provider !== 'Goodreads' || r.verified === true));
  const ratings: Rating[] = usable.filter((r, i) => !usable.slice(0, i).some(n => n.provider === r.provider && n.scope === r.scope))
    .map(r => ({ ...r, retrievedAt: r.retrievedAt || new Date().toISOString() }));
  for (const r of previous?.ratings || []) if (!ratings.some(n => n.provider === r.provider && n.scope === r.scope)) ratings.push(r);
  return { ...book, workId: book.workId || previous?.workId, hardcoverId: book.hardcoverId || previous?.hardcoverId,
    coverUrl: book.coverUrl || previous?.coverUrl, coverUrls: book.coverUrls?.length ? book.coverUrls : previous?.coverUrls,
    ...mergeClassification([book, ...(previous ? [previous] : [])]), plannedSequel: book.plannedSequel || previous?.plannedSequel,
    classificationEvidence: book.classificationEvidence || previous?.classificationEvidence, isbn: book.isbn ? normalizeIsbn(book.isbn) : undefined, ratings, warnings: [],
    goodreadsUrl: verifiedGoodreadsUrl(book.goodreadsUrl) ? book.goodreadsUrl : previous?.goodreadsUrl,
    source: 'personal-cache', retrievedAt: new Date().toISOString(), matchingConfidence: 'identified' };
}
export function createPersonalCache(db: CacheDatabase) {
  const ready = (async () => {
    const version = await db.getFirstAsync<{user_version: number}>('PRAGMA user_version');
    if ((version?.user_version || 0) > 1) throw new Error('Personal cache needs a newer app');
    await db.execAsync(personalSchema);
  })();
  void ready.catch(() => {});
  let queue: Promise<unknown> = ready;
  return {
    ready,
    save(book: BookResult, active: () => boolean = () => true): Promise<void> {
      const key = cacheIdentity(book);
      if (!key) return Promise.resolve();
      const write = queue.catch(() => {}).then(async () => {
        await ready;
        if (!active()) return;
        // A text-only result may acquire a verified work ID during enrichment.
        // Migrate that provisional key atomically, without merging two known works.
        const provisional = !book.isbn ? cacheIdentity({ ...book, workId: undefined, hardcoverId: undefined }) : null;
        const alias = provisional && provisional !== key ? await db.getFirstAsync<{metadata: string}>('SELECT metadata FROM personal_books WHERE identity=?', provisional) : null;
        const row = await db.getFirstAsync<{metadata: string}>('SELECT metadata FROM personal_books WHERE identity=?', key) || alias;
        let previous: BookResult | undefined;
        try { previous = row ? JSON.parse(row.metadata) : undefined; } catch { /* replace only this damaged row */ }
        if (previous && (normalizeText(previous.title) !== normalizeText(book.title) || previous.authors.map(normalizeText).sort().join('|') !== book.authors.map(normalizeText).sort().join('|'))) return;
        const saved = reusableBook(book, previous);
        if (!active()) return;
        await db.execAsync('BEGIN IMMEDIATE');
        try {
          await db.runAsync('INSERT INTO personal_books(identity,isbn,metadata,retrieved_at) VALUES (?,?,?,?) ON CONFLICT(identity) DO UPDATE SET metadata=excluded.metadata,retrieved_at=excluded.retrieved_at',
            key, saved.isbn || '', JSON.stringify(saved), saved.retrievedAt!);
          if (alias && provisional) await db.runAsync('DELETE FROM personal_books WHERE identity=?', provisional);
          await db.execAsync('COMMIT');
        } catch (error) { await db.execAsync('ROLLBACK').catch(() => {}); throw error; }
      });
      queue = write;
      return write;
    },
    async search(query: BookQuery): Promise<BookResult[]> {
      await ready; await queue.catch(() => {});
      const rows = query.isbn ? await db.getAllAsync<{metadata: string}>('SELECT metadata FROM personal_books WHERE isbn=?', normalizeIsbn(query.isbn))
        : await db.getAllAsync<{metadata: string}>('SELECT metadata FROM personal_books');
      return rows.flatMap(row => {
        try {
          const book: BookResult = JSON.parse(row.metadata);
          if (!cacheIdentity(book) || !Array.isArray(book.ratings)) return [];
          const saved = { ...book, ratings: book.ratings.map(r => ({ ...r, stored: true })) };
          return matchBook(query, saved).score >= 0.75 ? [saved] : [];
        } catch { return []; }
      });
    },
  };
}
