import { BookResult, ProviderBook } from '../../models/book';
import { BookQuery } from '../../recognition/types';
import { normalizeIsbn } from '../../utils/isbn';
import { Fetcher, httpsCover, json, object, rating, string, strings } from './shared';

export async function googleBooksSearch(query: BookQuery, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<BookResult[]> {
  const q = query.isbn ? `isbn:${query.isbn}` : query.text || [query.title ? `intitle:${query.title}` : '', query.author ? `inauthor:${query.author}` : ''].join(' ');
  const response = object(await json(`https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({ q, maxResults: '12' })}`, fetcher, false, 3500, signal));
  return (Array.isArray(response.items) ? response.items : []).flatMap((item: unknown) => {
    const volume = object(object(item).volumeInfo), title = string(volume.title);
    if (!title) return [];
    const identifiers = Array.isArray(volume.industryIdentifiers) ? volume.industryIdentifiers : [];
    if (query.isbn && !identifiers.some((v: unknown) => normalizeIsbn(String(object(v).identifier)) === query.isbn)) return [];
    const images = object(volume.imageLinks);
    const coverUrls = [images.large, images.medium, images.thumbnail, images.smallThumbnail].map(httpsCover).filter((url): url is string => !!url);
    return [{ identity: query.isbn ? 'isbn' as const : 'work' as const, isbn: query.isbn, title,
      authors: strings(volume.authors), coverUrl: coverUrls[0], coverUrls,
      seriesStatus: 'unknown' as const, ratings: [{ provider: 'Google Books' as const, ...rating(volume.averageRating, volume.ratingsCount) }], warnings: [] }];
  });
}
export async function googleBooks(isbn: string): Promise<ProviderBook | null> {
  const book = (await googleBooksSearch({ isbn }))[0];
  return book ? { ...book, rating: book.ratings[0] } : null;
}
