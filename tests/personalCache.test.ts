import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheDatabase, createPersonalCache } from '../src/services/personalCache';
import { BookResult } from '../src/models/book';
import { identifyBook } from '../src/services/identifyBook';
import { primaryRating } from '../src/utils/ratings';
import { normalizeOpenLibrary } from '../src/services/providers/openLibrary';
import { goodreadsReviewsUrl } from '../src/utils/goodreads';

const book: BookResult = { isbn: '9780765320308', title: 'Warbreaker', authors: ['Brandon Sanderson'], seriesStatus: 'unknown',
  ratings: [{ provider: 'Hardcover', average: 4.2, count: 500, scope: 'work', verified: true }], warnings: [] };
function adapter(db: DatabaseSync): CacheDatabase {
  return { async execAsync(sql) { db.exec(sql); }, async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
    async getFirstAsync<T>(sql: string, ...params: string[]) { return (db.prepare(sql).get(...params) || null) as T | null; },
    async getAllAsync<T>(sql: string, ...params: string[]) { return db.prepare(sql).all(...params) as T[]; } };
}
test('identified online book survives SQLite restart and monthly catalog replacement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookmarkit-')), path = join(dir, 'personal.db');
  let db = new DatabaseSync(path);
  try {
    const cache = createPersonalCache(adapter(db));
    const found = await identifyBook({ isbn: book.isbn }, { online: async () => true, isbn: async () => book });
    assert.equal(found.kind, 'book'); if (found.kind === 'book') await cache.save(found.book);
    const monthly = new DatabaseSync(join(dir, 'monthly.db')); monthly.exec('CREATE TABLE works(id TEXT); DROP TABLE works;'); monthly.close();
    db.close(); db = new DatabaseSync(path);
    const restarted = createPersonalCache(adapter(db));
    const result = await identifyBook({ isbn: book.isbn }, { catalog: restarted, online: async () => false });
    assert.equal(result.kind, 'book'); if (result.kind === 'book') assert.equal(primaryRating(result.book.ratings)?.provider, 'Hardcover');
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});
test('repeat scans and progressive ratings upsert once, preserve provider counts on failure', async () => {
  const db = new DatabaseSync(':memory:'), cache = createPersonalCache(adapter(db));
  await Promise.all([cache.save(book), cache.save(book)]);
  await cache.save({ ...book, ratings: [{ provider: 'Goodreads', average: 4.5, count: 900, verified: true, scope: 'work' }] });
  await cache.save({ ...book, ratings: [{ provider: 'Hardcover', unavailable: true }] });
  const saved = (await cache.search({ isbn: book.isbn }))[0];
  assert.equal(db.prepare('SELECT count(*) n FROM personal_books').get()!.n, 1);
  assert.equal(primaryRating(saved.ratings)?.count, 900);
  assert.equal(saved.ratings.find(r => r.provider === 'Hardcover')?.count, 500); db.close();
});
test('editions, no ISBN books and ambiguous titles remain separate', async () => {
  const db = new DatabaseSync(':memory:'), cache = createPersonalCache(adapter(db));
  await cache.save(book); await cache.save({ ...book, isbn: '9780765360038' });
  await cache.save({ ...book, isbn: undefined, workId: '/works/OL123W' });
  await cache.save({ ...book, isbn: undefined, title: 'Shared title', authors: ['First author'] });
  await cache.save({ ...book, isbn: undefined, title: 'Shared title', authors: ['Second author'] });
  assert.equal((await cache.search({ isbn: book.isbn })).length, 1);
  const ambiguous = await identifyBook({ title: 'Shared title' }, { catalog: cache, online: async () => false });
  assert.equal(ambiguous.kind, 'candidates');
  assert.equal((await cache.search({ title: 'Warbreaker', author: book.authors[0] })).length, 3); db.close();
});
test('stale scans cannot write, interrupted write retains prior row and next write succeeds', async () => {
  const db = new DatabaseSync(':memory:'), real = adapter(db); let fail = false;
  const cache = createPersonalCache({ ...real, async runAsync(sql, ...args) { if (fail) throw Error('Interrupted'); return real.runAsync(sql, ...args); } });
  await cache.save(book); await cache.save({ ...book, title: 'Stale' }, () => false);
  fail = true; await assert.rejects(cache.save({ ...book, ratings: [] })); fail = false;
  assert.equal((await cache.search({ isbn: book.isbn }))[0].title, book.title);
  await cache.save(book); db.close();
});
test('damaged row fails closed without erasing intact records', async () => {
  const db = new DatabaseSync(':memory:'), cache = createPersonalCache(adapter(db)); await cache.save(book);
  db.exec("INSERT INTO personal_books VALUES ('bad','','broken','now')");
  assert.equal((await cache.search({ title: book.title })).length, 1); db.close();
});
test('exact edition Goodreads ID produces link independently of score; wrong ISBN and malformed links rejected', () => {
  const e = { title: book.title, isbn_13: [book.isbn], identifiers: { goodreads: ['1268479'] } };
  const mapped = normalizeOpenLibrary(e, {}, [], {}, book.isbn!)!;
  const result = { ...mapped, ratings: [mapped.rating], warnings: [] };
  assert.equal(goodreadsReviewsUrl(result), 'https://www.goodreads.com/book/show/1268479');
  assert.equal(primaryRating(result.ratings), undefined);
  assert.equal(normalizeOpenLibrary({ ...e, isbn_13: ['9780439023481'] }, {}, [], {}, book.isbn!)!.goodreadsUrl, undefined);
  assert.equal(normalizeOpenLibrary({ ...e, identifiers: { goodreads: ['12', '13'] } }, {}, [], {}, book.isbn!)!.goodreadsUrl, undefined);
  assert.ok(goodreadsReviewsUrl({ ...book, goodreadsUrl: 'https://evil.example/book/show/12' }).includes('/search?'));
});


test('progressive work identity replaces provisional text key atomically', async () => {
 const db=new DatabaseSync(':memory:'),cache=createPersonalCache(adapter(db));
 await cache.save({...book,isbn:undefined});
 await cache.save({...book,isbn:undefined,workId:'/works/OL123W'});
 assert.equal(db.prepare('SELECT count(*) n FROM personal_books').get()!.n,1);
 assert.equal((await cache.search({title:book.title,author:book.authors[0]}))[0].workId,'/works/OL123W');db.close();
});

test('v1 migration indexes 100 to 10000 real SQLite records with bounded JSON retrieval', async () => {
 const benchmarks: unknown[]=[];
 for (const size of [100,1000,5000,10000]) {
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE personal_books(identity TEXT PRIMARY KEY,isbn TEXT,metadata TEXT NOT NULL,retrieved_at TEXT NOT NULL); PRAGMA user_version=1; BEGIN');
  const insert=db.prepare('INSERT INTO personal_books VALUES (?,?,?,?)');
  for (let i=0;i<size;i++) insert.run(`hc:${i+1}`,'',JSON.stringify({...book,isbn:undefined,hardcoverId:String(i+1),title:`Indexed novel ${i}`}), '2026-10-01');
  db.exec('COMMIT');let decoded=0;
  const real=adapter(db),cache=createPersonalCache({...real,async getAllAsync<T>(sql:string,...params:string[]) {
   const rows=await real.getAllAsync<T>(sql,...params);if(sql.includes('SELECT metadata')||sql.includes('SELECT b.metadata'))decoded+=rows.length;return rows;
  }});
  const begin=performance.now();await cache.ready;const migrationMs=performance.now()-begin;
  assert.equal(db.prepare('SELECT count(*) n FROM personal_books').get()!.n,size);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,2);
  const times:number[]=[];
  for(let i=0;i<30;i++) {const start=performance.now();assert.equal((await cache.search({title:`Indexed novel ${size-1}`,author:book.authors[0]})).length,1);times.push(performance.now()-start);}
  assert.equal(decoded,30,'One indexed metadata row per exact search');
  assert.match(String(db.prepare('EXPLAIN QUERY PLAN SELECT identity FROM personal_titles WHERE title=?').get('indexed novel 0')!.detail),/personal_normalized_title/);
  benchmarks.push({size,migrationMs,searchMedianMs:times.sort((a,b)=>a-b)[15],searchP95Ms:times[28],jsonRowsPerSearch:decoded/30});
  assert.equal((await cache.search({author:book.authors[0]})).length,0,'Truncated set cannot silently select a work');db.close();
 }
 mkdirSync('dist/v5',{recursive:true});writeFileSync('dist/v5/personal-benchmarks.json',JSON.stringify(benchmarks,null,2)+'\n');
});

test('failed v1 backfill rolls back schema/version and retains every personal record', async () => {
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE personal_books(identity TEXT PRIMARY KEY,isbn TEXT,metadata TEXT NOT NULL,retrieved_at TEXT NOT NULL);PRAGMA user_version=1');
 db.prepare('INSERT INTO personal_books VALUES (?,?,?,?)').run('isbn:'+book.isbn,book.isbn!,JSON.stringify(book),'2026-10-01');
 const real=adapter(db);const failed=createPersonalCache({...real,async runAsync(){throw Error('Interrupted migration');}});
 await assert.rejects(failed.ready,/Interrupted migration/);
 assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,1);
 assert.equal(db.prepare('SELECT count(*) n FROM personal_books').get()!.n,1);
 const recovered=createPersonalCache(real);await recovered.ready;assert.equal((await recovered.search({isbn:book.isbn})).length,1);db.close();
});
