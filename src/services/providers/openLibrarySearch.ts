import { BookResult } from '../../models/book';
import { BookQuery } from '../../recognition/types';
import { Fetcher, httpsCover, json, object, rating, string, strings, ProviderError } from './shared';

export async function openLibrarySearch(query: BookQuery, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<BookResult[]> {
  const params = new URLSearchParams({ limit: '12', fields: 'key,title,author_name,cover_i,ratings_average,ratings_count' });
  if (query.text) params.set('q', query.text);
  else { params.set('title', query.title || ''); if (query.author) params.set('author', query.author); }
  const result = object(await json(`https://openlibrary.org/search.json?${params}`, fetcher, false, 5000, signal));
  if (!Array.isArray(result.docs)) throw new ProviderError('malformed');
  return result.docs.slice(0, 12).flatMap((value: unknown) => {
    const doc = object(value), title = string(doc.title), key = string(doc.key);
    if (!title || !key || !/^\/works\/OL\d+W$/.test(key)) return [];
    const cover = Number.isSafeInteger(doc.cover_i) && doc.cover_i > 0 ? httpsCover(`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`) : undefined;
    return [{ identity: 'work', title, authors: strings(doc.author_name), coverUrl: cover,
      workId: key, seriesStatus: 'unknown', ratings: [{ provider: 'Open Library', ...rating(doc.ratings_average, doc.ratings_count) }], warnings: [] }];
  });
}
