export function validRecord(r: unknown, now = Date.now()): r is Record<string, unknown> {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const v = r as Record<string, unknown>, id = String(v.book_id || ''), at = Date.parse(String(v.retrieved_at || ''));
  const evidence = v.evidence as Record<string, unknown> | undefined;
  return v.status === 'verified' && (v.match_confidence === 'exact_isbn' || v.match_confidence === 'title_author') &&
    /^[1-9]\d{0,15}$/.test(id) && (v.goodreads_work_id === null || /^[1-9]\d{0,15}$/.test(String(v.goodreads_work_id))) &&
    new RegExp('^https://www\\.goodreads\\.com/book/show/' + id + '(?:[-.][A-Za-z0-9_%.-]+)?$').test(String(v.url)) &&
    /^\/works\/OL\d+W$/.test(String(v.work_id)) &&
    (v.isbn13 === null || /^97[89]\d{10}$/.test(String(v.isbn13))) &&
    (v.rating_scope === 'work' || (v.rating_scope === 'edition' && typeof v.isbn13 === 'string')) &&
    typeof v.average === 'number' && Number.isFinite(v.average) && v.average > 0 && v.average <= 5 &&
    typeof v.rating_count === 'number' && Number.isSafeInteger(v.rating_count) && v.rating_count > 0 &&
    Number.isFinite(at) && at <= now + 300000 && !!evidence && evidence.method === 'goodread-v0.3.1' &&
    typeof evidence.title === 'string' && Array.isArray(evidence.authors) && evidence.authors.length > 0 &&
    (v.series_name === null && v.series_position === null || typeof v.series_name === 'string' && v.series_name.length <= 200 &&
      typeof v.series_position === 'string' && /^\d+(?:\.\d+)?$/.test(v.series_position) && Number(v.series_position) > 0);
}
