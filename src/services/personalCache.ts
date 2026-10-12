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
CREATE TABLE IF NOT EXISTS personal_titles (identity TEXT PRIMARY KEY, title TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS personal_normalized_title ON personal_titles(title,identity);
CREATE TABLE IF NOT EXISTS personal_tokens (token TEXT NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(token,identity)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS personal_token_identity ON personal_tokens(identity);
CREATE TABLE IF NOT EXISTS personal_grams (gram TEXT NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(gram,identity)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS personal_gram_identity ON personal_grams(identity);
PRAGMA user_version=2;
COMMIT;`;

async function indexBook(db: CacheDatabase, identity: string, book: BookResult) {
  await db.runAsync('INSERT INTO personal_titles VALUES (?,?) ON CONFLICT(identity) DO UPDATE SET title=excluded.title', identity, normalizeText(book.title));
  await db.runAsync('DELETE FROM personal_tokens WHERE identity=?', identity);
  const tokens = new Set(normalizeText([book.title, ...book.authors].join(' ')).slice(0, 1600).split(' ').filter(Boolean));
  for (const token of tokens) await db.runAsync('INSERT OR IGNORE INTO personal_tokens VALUES (?,?)', token, identity);
  await db.runAsync('DELETE FROM personal_grams WHERE identity=?', identity);
  const title = normalizeText(book.title).slice(0, 240);
  const grams = new Set(Array.from({length: Math.max(0, title.length - 2)}, (_, i) => title.slice(i, i + 3)));
  for (const gram of grams) await db.runAsync('INSERT OR IGNORE INTO personal_grams VALUES (?,?)', gram, identity);
}

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
    if ((version?.user_version || 0) > 2) throw new Error('Personal cache needs a newer app');
    // Keep the v1 file and records. Index backfill and schema version commit together.
    await db.execAsync(personalSchema.replace('PRAGMA user_version=2;\nCOMMIT;', ''));
    try {
      if ((version?.user_version || 0) < 2) {
        let after = '';
        while (true) {
          const rows = await db.getAllAsync<{ identity: string; metadata: string }>('SELECT identity,metadata FROM personal_books WHERE identity>? ORDER BY identity LIMIT 200', after);
          if (!rows.length) break;
          for (const row of rows) {
            let book: BookResult;
            try { book = JSON.parse(row.metadata); if (!cacheIdentity(book)) continue; } catch { continue; }
            await indexBook(db, row.identity, book);
          }
          after = rows[rows.length - 1].identity;
        }
      }
      await db.execAsync('PRAGMA user_version=2; COMMIT;');
    } catch (error) { await db.execAsync('ROLLBACK').catch(() => {}); throw error; }
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
          await indexBook(db, key, saved);
          if (alias && provisional) {
            await db.runAsync('DELETE FROM personal_books WHERE identity=?', provisional);
            await db.runAsync('DELETE FROM personal_titles WHERE identity=?', provisional);
            await db.runAsync('DELETE FROM personal_tokens WHERE identity=?', provisional);
            await db.runAsync('DELETE FROM personal_grams WHERE identity=?', provisional);
          }
          await db.execAsync('COMMIT');
        } catch (error) { await db.execAsync('ROLLBACK').catch(() => {}); throw error; }
      });
      queue = write;
      return write;
    },
    async search(query: BookQuery): Promise<BookResult[]> {
      await ready; await queue.catch(() => {});
      let rows: {metadata: string}[];
      if (query.isbn) rows = await db.getAllAsync('SELECT metadata FROM personal_books WHERE isbn=?', normalizeIsbn(query.isbn));
      else {
        const text = normalizeText(query.title || query.text || '').slice(0, 240);
        rows = text ? await db.getAllAsync('SELECT b.metadata FROM personal_books b JOIN personal_titles t ON t.identity=b.identity WHERE t.title=? ORDER BY b.identity LIMIT 81', text) : [];
        if (!rows.length) {
          const tokens = [...new Set(normalizeText(query.text || [query.title, query.author].filter(Boolean).join(' ')).slice(0, 400).split(' ').filter(Boolean))].slice(0, 16);
          if (!tokens.length) return [];
          rows = await db.getAllAsync(`SELECT metadata FROM personal_books WHERE identity IN (SELECT identity FROM personal_tokens WHERE token IN (${tokens.map(() => '?').join(',')}) GROUP BY identity ORDER BY COUNT(*) DESC,identity LIMIT 81)`, ...tokens);
          if ((!rows.length || rows.length > 80) && text) {
            const grams = [...new Set(Array.from({length: Math.max(0, text.length - 2)}, (_, i) => text.slice(i, i + 3)))].slice(0, 40);
            if (grams.length) rows = await db.getAllAsync(`SELECT metadata FROM personal_books WHERE identity IN (SELECT identity FROM personal_grams WHERE gram IN (${grams.map(() => '?').join(',')}) GROUP BY identity ORDER BY COUNT(*) DESC,identity LIMIT 81)`, ...grams);
          }
        }
        // Never claim certainty when a bounded candidate set was truncated.
        if (rows.length > 80) return [];
      }
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
