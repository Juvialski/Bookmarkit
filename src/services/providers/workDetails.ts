import { BookResult } from '../../models/book';
import { mergeClassification } from '../../utils/classification';
import { Fetcher, json, object, strings } from './shared';
import { parseSeriesStatement } from './openLibrary';
export function createWorkEnricher(fetcher: Fetcher = fetch, now = Date.now) {
  const cache = new Map<string, { series: ReturnType<typeof mergeClassification>; expires: number }>();
  return async (book: BookResult, signal?: AbortSignal): Promise<BookResult> => {
    if (book.isbn || !book.workId || !/^\/works\/OL\d+W$/.test(book.workId)) return book;
    const hit = cache.get(book.workId);
    if (hit && hit.expires > now()) return { ...book, ...mergeClassification([book, hit.series]) };
    cache.delete(book.workId);
    try {
      const work = object(await json(`https://openlibrary.org${book.workId}.json`, fetcher, false, 2500, signal));
      if (work.key !== book.workId) return book;
      const statements = strings(work.series).map(parseSeriesStatement);
      const series = statements.length && statements.every(Boolean)
        ? mergeClassification(statements.map(s => ({ seriesStatus: 'series', seriesName: s!.name, seriesPosition: s!.position, classificationSource: 'open-library', classificationConfidence: 'explicit' })))
        : { seriesStatus: 'unknown' as const, classificationSource: 'unknown' as const };
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(book.workId, { series, expires: now() + 300000 });
      return { ...book, ...mergeClassification([book, series]) };
    } catch { return book; } // Optional work metadata cannot erase an identified book/rating.
  };
}
