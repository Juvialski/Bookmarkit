import { ProviderBook } from '../../models/book';
import { Fetcher, json, object, rating, string, strings, ProviderError } from './shared';

export function parseSeriesStatement(value: string): { name: string; position: string } | null {
  const match = value.trim().match(/^(.+?)(?:\s*[;,:-]\s*|\s+)(?:\((?:#\s*|(?:book|vol\.?|volume|no\.?)\s+)(\d+(?:\.\d+)?)\)|(?:#\s*|(?:book|vol\.?|volume|no\.?)\s+)(\d+(?:\.\d+)?))\s*[.;]?$/i);
  if (!match) return null;
  const name = match[1].trim().replace(/[;,:-]+$/, '').trim();
  const position = match[2] || match[3];
  return name && !/[#()]|\b(?:book|vol\.?|volume|no\.?)\s+\d/i.test(name) && Number(position) > 0 ? { name, position } : null;
}

export function normalizeOpenLibrary(edition: unknown, work: unknown, authors: unknown[], ratings: unknown, isbn: string): ProviderBook | null {
  const e = object(edition), w = object(work);
  const title = string(e.title) || string(w.title);
  if (!title) return null;
  const coverId = [...(Array.isArray(e.covers) ? e.covers : []), ...(Array.isArray(w.covers) ? w.covers : [])].find(id => Number.isInteger(id) && id > 0);
  // Series statements vary widely. Accept only a single explicit statement with
  // a numbered marker such as "#1", "book 1", "vol. 1", or "volume 1".
  // Never infer a series from the title or subjects.
  const editionSeries = strings(e.series);
  const workSeries = strings(w.series);
  const series = [...new Set([...editionSeries, ...workSeries].map(value => value.trim()))];
  const parsedSeries = series.length === 1 ? parseSeriesStatement(series[0]) : null;
  const summary = object(object(ratings).summary);
  const workId = Array.isArray(e.works) ? string(object(e.works[0]).key) : undefined;
  return { isbn, title, authors: authors.map(a => string(object(a).name)).filter((a): a is string => !!a),
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : undefined,
    workId, seriesStatus: parsedSeries ? 'series' : 'unknown', seriesName: parsedSeries?.name, seriesPosition: parsedSeries?.position,
    rating: { provider: 'Open Library', ...rating(summary.average, summary.count) } };
}
export async function openLibrary(isbn: string, fetcher: Fetcher = fetch): Promise<ProviderBook | null> {
  const edition = await json(`https://openlibrary.org/isbn/${isbn}.json`, fetcher, true);
  if (!edition) return null;
  const e = object(edition);
  if (!string(e.title)) throw new ProviderError('malformed');
  const key = Array.isArray(e.works) ? string(object(e.works[0]).key) : undefined;
  const workKey = key && /^\/works\/OL\d+W$/.test(key) ? key : undefined;
  const optional = async (url: string) => { try { return await json(url, fetcher); } catch { return undefined; } };
  const [work, ratings] = await Promise.all([workKey ? optional(`https://openlibrary.org${workKey}.json`) : undefined, workKey ? optional(`https://openlibrary.org${workKey}/ratings.json`) : undefined]);
  const refs = Array.isArray(e.authors) && e.authors.length ? e.authors : object(work).authors;
  const authorKeys = Array.isArray(refs) ? [...new Set(refs.map(ref => string(object(ref).key) || string(object(object(ref).author).key)).filter((key): key is string => !!key && /^\/authors\/OL\d+A$/.test(key)))].slice(0, 8) : [];
  const authors = await Promise.all(authorKeys.map(key => optional(`https://openlibrary.org${key}.json`)));
  const result = normalizeOpenLibrary(edition, work, authors, ratings, isbn);
  if (result && workKey && ratings === undefined) { result.rating.unavailable = true; result.warnings = ['Open Library ratings could not be loaded.']; }
  if (result && ((workKey && work === undefined) || authors.some(a => a === undefined))) result.warnings = [...(result.warnings || []), 'Some Open Library details could not be loaded.'];
  return result;
}
