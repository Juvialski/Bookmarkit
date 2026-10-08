import { ensureActive } from '../recognition/session';
import { BookResult } from '../models/book';
import { BookCatalog, BookQuery, Identification, RecognitionRequest } from '../recognition/types';
import { rankBooks } from '../recognition/matching';
import { normalizeText } from '../recognition/normalization';
import { isValidIsbn, normalizeIsbn } from '../utils/isbn';
import { lookupBook } from './bookLookup';
import { providerSearch } from './providers/search';
import { ProviderError } from './providers/shared';

export function manualQuery(value: string): RecognitionRequest {
  const text = value.trim().replace(/\s+/g, ' ').slice(0, 240);
  if (!text) throw new Error('Enter a title, author, or ISBN.');
  const isbn = normalizeIsbn(text);
  if (/^[\dXx\s-]+$/.test(text) && isbn.length >= 10) {
    if (!isValidIsbn(isbn)) throw new Error('Enter a valid ISBN-10 or ISBN-13.');
    return { isbn, origin: 'manual' };
  }
  // Free text is deliberately not split into one guessed title/name. Providers
  // retrieve candidates; their metadata establishes title+author token roles.
  return { text, origin: 'manual' };
}
export interface ResolverDependencies {
  catalog?: BookCatalog;
  search?: (query: BookQuery, signal?: AbortSignal) => Promise<BookResult[]>;
  isbn?: (isbn: string) => Promise<BookResult>;
  online?: () => Promise<boolean>;
}
export async function identifyBook(request: RecognitionRequest, dependencies: ResolverDependencies = {}, signal?: AbortSignal): Promise<Identification> {
  ensureActive(signal);
  const byIsbn = dependencies.isbn || lookupBook;
  if (request.isbn && isValidIsbn(normalizeIsbn(request.isbn))) {
    const isbn = normalizeIsbn(request.isbn);
    if (dependencies.online && !(await dependencies.online()) && dependencies.catalog) {
      const books = await dependencies.catalog.search({ isbn });
      if (books[0]) return { kind: 'book', book: books[0] };
      throw new Error('This ISBN is not in the offline catalog. Connect to the internet to look it up.');
    }
    return { kind: 'book', book: await byIsbn(isbn) };
  }
  const queries = (request.candidates?.length ? request.candidates : [request]).filter(q => q.title || q.text || q.author).slice(0, 32);
  if (!queries.length) throw new Error('No readable title found. Move closer to the cover and scan again.');
  let stored: BookResult[] = [];
  let catalogFailed = false;
  if (dependencies.catalog) {
    try { stored = (await Promise.all(queries.map(q => dependencies.catalog!.search(q)))).flat(); }
    catch { catalogFailed = true; }
  }
  const local = rankBooks(queries, stored);
  if (dependencies.online && !(await dependencies.online())) {
    if (local) return local;
    throw new Error(catalogFailed ? 'The offline catalog could not be read. Try again.' : request.origin === 'cover'
      ? 'Book cover read successfully. Connect to the internet to look up this book.'
      : 'This book is not in the offline catalog. Connect to the internet to look it up.');
  }
  // Four bounded requests maximum. Alternate author hypotheses for the same
  // title are ranked locally; broad title searches avoid a bad author guess
  // excluding the correct book upstream.
  const searches: BookQuery[] = [];
  for (const q of queries) {
    const broad = q.text ? { text: q.text } : q.title ? { title: q.title } : { author: q.author };
    if (!searches.some(s => normalizeText(s.text || s.title || s.author || '') === normalizeText(broad.text || broad.title || broad.author || ''))) searches.push(broad);
    if (searches.length === 4) break;
  }
  const responses: PromiseSettledResult<BookResult[]>[] = [];
  for (const query of searches) {
    ensureActive(signal);
    try {
      const books = await (dependencies.search || providerSearch)(query, signal);
      ensureActive(signal);
      responses.push({ status: 'fulfilled', value: books });
      const identified = rankBooks(queries, [...responses.flatMap(r => r.status === 'fulfilled' ? r.value : []), ...stored]);
      if (identified?.kind === 'book') return identified;
    } catch (reason) {
      responses.push({ status: 'rejected', reason });
      if (reason instanceof ProviderError && (reason.kind === 'network' || reason.kind === 'timeout' || reason.kind === 'rate-limit')) break;
    }
  }
  const online = responses.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  // Network metadata replaces the same local work; stored provenance is retained
  // if there is no online hit. Do not merge ratings across unrelated works.
  const result = rankBooks(queries, [...online, ...stored]);
  if (result) return result;
  const failures = responses.flatMap(r => r.status === 'rejected' ? [r.reason] : []);
  if (request.origin === 'cover' && failures.length === responses.length && failures.every(e => e instanceof ProviderError && (e.kind === 'network' || e.kind === 'timeout'))) {
    throw new Error('Book cover read successfully. Connect to the internet to look up this book.');
  }
  if (failures.length) throw new Error('Book services are unavailable. Your text was read; try again when connected.');
  throw new Error('No confident match found. Try scanning closer or use Manual Search.');
}
