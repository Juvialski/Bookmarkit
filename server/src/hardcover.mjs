// Fields checked against hardcoverapp/hardcover-docs; see server/README.md.
export const QUERY = `query BookByIsbn($isbn: String!) {
  editions(where: {isbn_13: {_eq: $isbn}}, order_by: {id: asc}, limit: 2) {
    isbn_13 title image { url }
    book {
      id title slug rating ratings_count image { url }
      contributions(limit: 8, order_by: {id: asc}) { contribution author { name } }
      featured_book_series { compilation position series { name } }
    }
  }
}`;

export class LookupError extends Error {
  constructor(status = 502) { super('Book service temporarily unavailable.'); this.status = status; }
}
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : undefined;
const number = value => typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) ? Number(value) : NaN;
const https = value => {
  try { const url = new URL(text(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
};
export function validIsbn(isbn) {
  return /^(978|979)\d{10}$/.test(isbn) && [...isbn].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0;
}
export function normalizeHardcover(payload, isbn) {
  const root = object(payload), editions = object(root.data).editions;
  if (root.errors || !Array.isArray(editions) || editions.length > 2) throw new LookupError();
  if (!editions.length) return { found: false };
  if (editions.some(e => object(e).isbn_13 !== isbn)) throw new LookupError();
  const edition = object(editions[0]), book = object(edition.book);
  const title = text(edition.title) || text(book.title);
  if (!title || !Number.isSafeInteger(book.id) || book.id <= 0 || editions.some(e => object(object(e).book).id !== book.id)) throw new LookupError();
  const count = number(book.ratings_count), average = number(book.rating);
  const series = object(book.featured_book_series), position = number(series.position), name = text(object(series.series).name);
  const hasSeries = series.compilation === false && Number.isFinite(position) && position > 0 && !!name;
  const authors = Array.isArray(book.contributions) ? [...new Set(book.contributions.slice(0, 8)
    .filter(c => object(c).contribution == null || object(c).contribution === 'Author')
    .map(c => text(object(object(c).author).name)).filter(Boolean))] : [];
  const slug = text(book.slug);
  return { found: true, isbn, title, authors, hardcoverId: String(book.id),
    coverUrl: https(object(edition.image).url) || https(object(book.image).url),
    rating: Number.isFinite(average) && average > 0 && average <= 5 && count !== 0 ? average : undefined,
    ratingsCount: Number.isSafeInteger(count) && count >= 0 ? count : undefined,
    seriesName: hasSeries ? name : undefined, seriesPosition: hasSeries ? String(position) : undefined,
    url: slug && /^[a-z0-9-]+$/.test(slug) ? `https://hardcover.app/books/${slug}` : undefined };
}

async function boundedJson(response) {
  if (!response.body) throw new LookupError();
  const reader = response.body.getReader();
  let bytes = 0, chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) { await reader.cancel(); throw new LookupError(); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new LookupError(); }
  finally { reader.releaseLock(); }
}

export function createHardcoverLookup({ token = '', fetcher = fetch, now = Date.now, maxSize = 256,
  successTtlMs = 6 * 60 * 60 * 1000, missTtlMs = 5 * 60 * 1000, timeoutMs = 5000, maxConcurrent = 4 } = {}) {
  const cache = new Map(), pending = new Map();
  return async function lookup(isbn) {
    if (!validIsbn(isbn)) throw new LookupError(400);
    if (!token.trim()) throw new LookupError(503);
    const hit = cache.get(isbn);
    if (hit && hit.expires > now()) return hit.book;
    cache.delete(isbn);
    if (pending.has(isbn)) return pending.get(isbn);
    if (pending.size >= maxConcurrent) throw new LookupError(503);
    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher('https://api.hardcover.app/v1/graphql', {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim().replace(/^Bearer\s+/i, '')}` },
          body: JSON.stringify({ query: QUERY, variables: { isbn } })
        });
        if (!response.ok) { await response.body?.cancel(); throw new LookupError(response.status === 429 ? 503 : 502); }
        const book = normalizeHardcover(await boundedJson(response), isbn);
        for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key);
        if (cache.size >= maxSize) cache.delete(cache.keys().next().value);
        cache.set(isbn, { book, expires: now() + (book.found ? successTtlMs : missTtlMs) });
        return book;
      } catch (error) { throw new LookupError(controller.signal.aborted ? 504 : error instanceof LookupError ? error.status : 502); }
      finally { clearTimeout(timer); }
    })();
    pending.set(isbn, request);
    try { return await request; } finally { pending.delete(isbn); }
  };
}
