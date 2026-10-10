import { BookResult } from '../../models/book';
import { mergeClassification } from '../../utils/classification';
import { Fetcher, json, object, strings } from './shared';
import { parseSeriesStatement } from './openLibrary';
import { coverCandidates } from '../../utils/covers';
export function createWorkEnricher(fetcher: Fetcher = fetch, now = Date.now) {
  const cache = new Map<string, { series: ReturnType<typeof mergeClassification>; coverUrls: string[]; expires: number }>();
  return async (book: BookResult, signal?: AbortSignal): Promise<BookResult> => {
    if (!book.workId || !/^\/works\/OL\d+W$/.test(book.workId)) return book;
    const hit = cache.get(book.workId);
    if (hit && hit.expires > now()) { const coverUrls = coverCandidates(book, hit); return { ...book, coverUrl: coverUrls[0], coverUrls, ...mergeClassification([book, hit.series]) }; }
    cache.delete(book.workId);
    try {
      const work = object(await json(`https://openlibrary.org${book.workId}.json`, fetcher, false, 2500, signal));
      if (work.key !== book.workId) return book;
      const statements = strings(work.series).map(parseSeriesStatement);
      const series = statements.length && statements.every(Boolean)
        ? mergeClassification(statements.map(s => ({ seriesStatus: 'series', seriesName: s!.name, seriesPosition: s!.position, classificationSource: 'open-library', classificationConfidence: 'explicit' })))
        : { seriesStatus: 'unknown' as const, classificationSource: 'unknown' as const };
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      const workCovers = (Array.isArray(work.covers) ? work.covers : []).filter(id => Number.isSafeInteger(id) && id > 0)
        .map(id => `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`);
      cache.set(book.workId, { series, coverUrls: workCovers, expires: now() + 300000 });
      const coverUrls = coverCandidates(book, { coverUrls: workCovers });
      return { ...book, coverUrl: coverUrls[0], coverUrls, ...mergeClassification([book, series]) };
    } catch { return book; } // Optional work metadata cannot erase an identified book/rating.
  };
}
