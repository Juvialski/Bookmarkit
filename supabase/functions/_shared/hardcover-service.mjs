import { QUERY, LookupError, validIsbn, normalizeHardcover, boundedJson } from './hardcover.mjs';
export const normalizeIdentity = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const SEARCH = `query SearchBooks($query: String!) {
  search(query: $query, query_type: "Book", per_page: 25, page: 1) { results }
}`;
export const DETAILS = `query CandidateBooks($ids: [Int!]!) {
  books(where: {id: {_in: $ids}, book_status_id: {_eq: 1}, canonical_id: {_is_null: true}}, limit: 8) {
    id title slug book_status_id canonical_id rating ratings_count image { url }
    contributions(limit: 8, order_by: {id: asc}) { contribution author { name } }
    featured_book_series { compilation position series { name } }
  }
}`;
export const EXACT_TITLE = `query ExactTitleBooks($title: String!, $author: String!) {
  books(where: {title: {_eq: $title}, book_status_id: {_eq: 1}, canonical_id: {_is_null: true}, contributions: {author: {name: {_eq: $author}}}}, order_by: {id: asc}, limit: 9) {
    id title slug book_status_id canonical_id rating ratings_count image { url }
    contributions(limit: 8, order_by: {id: asc}) { contribution author { name } }
    featured_book_series { compilation position series { name } }
  }
}`;
export function validateQuery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['isbn','title','author'].includes(k))) throw new LookupError(400);
  if (input.isbn !== undefined) {
    if (!validIsbn(input.isbn) || input.title !== undefined || input.author !== undefined) throw new LookupError(400);
    return { isbn: input.isbn };
  }
  if (typeof input.title !== 'string' || typeof input.author !== 'string' || !input.title.trim() || !input.author.trim() ||
      input.title.length > 240 || input.author.length > 160 || !normalizeIdentity(input.title) || !normalizeIdentity(input.author)) throw new LookupError(400);
  return { title: input.title.trim(), author: input.author.trim() };
}
export function normalizeCandidates(payload, query, ids) {
  if (payload.errors || !Array.isArray(payload.data?.books) || payload.data.books.length > 8) throw new LookupError();
  const candidates = new Map();
  for (const book of payload.data.books) {
    if (!ids.includes(book.id)) throw new LookupError();
    if((book.book_status_id !== undefined && book.book_status_id !== 1) || book.canonical_id != null) continue;
    // Synthetic wrapper reuses work normalization, never an edition/ISBN claim.
    const normalized = normalizeHardcover({ data: { editions: [{ isbn_13: '9780439023481', title: book.title, book }] } }, '9780439023481');
    delete normalized.isbn;
    if (normalizeIdentity(book.title) !== normalizeIdentity(query.title) || normalizeIdentity(normalized.authors[0]) !== normalizeIdentity(query.author)) continue;
    const previous = candidates.get(normalized.hardcoverId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) throw new LookupError();
    candidates.set(normalized.hardcoverId, normalized);
  }
  if (candidates.size > 1) return { found: false, ambiguous: true };
  return candidates.values().next().value || { found: false };
}
export async function queryKey(query) {
  const text = query.isbn ? 'isbn:'+query.isbn : 'title:'+normalizeIdentity(query.title)+'|'+normalizeIdentity(query.author);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
}
/** @param {{token?: string, store?: any, fetcher?: typeof fetch, now?: ()=>number, timeoutMs?: number}} options */
export function createHardcoverService({ token='', store, fetcher=fetch, now=Date.now, timeoutMs=2200 }={}) {
  const pending = new Map();
  const request = async (query, variables) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),timeoutMs);
    try {
      const response = await fetcher('https://api.hardcover.app/v1/graphql',{ method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token.trim().replace(/^Bearer\s+/i,''),'User-Agent':'Bookmarkit/1.2 (read-only aggregate book metadata)'},
        body:JSON.stringify({query,variables}) });
      if ([429,401,403].includes(response.status)) {
        const retry=Number(response.headers.get('Retry-After'));
        await store.cooldown(response.status===429 && Number.isFinite(retry) && retry>0 ? Math.min(86400,Math.ceil(retry)) : 3600);
      }
      const daily=/"daily";r=0;t=(\d+)/.exec(response.headers.get('RateLimit') || '');
      if (daily) await store.cooldown(Math.min(86400,Math.max(60,Number(daily[1]))));
      if (!response.ok) { await response.body?.cancel(); throw new LookupError(response.status===429 ? 429 : 503); }
      return await boundedJson(response,query===SEARCH ? 262144 : 65536);
    } catch(error) { throw new LookupError(controller.signal.aborted ? 504 : error instanceof LookupError ? error.status : 502); }
    finally { clearTimeout(timer); }
  };
  return async input => {
    const query=validateQuery(input), key=await queryKey(query);
    if (pending.has(key)) return pending.get(key);
    const operation=(async () => {
      const cached=await store.get(key,query);
      if (cached && Date.parse(cached.expires_at)>now()) return {...cached.payload,cacheHit:true};
      if (!token.trim()) throw new LookupError(503);
      // One persistent budget across isolates; reservation also leases this key.
      if (!await store.reserve(key,query,query.isbn ? 1 : 3)) throw new LookupError(429);
      try {
        let result;
        if (query.isbn) {
          const payload=await request(QUERY,{isbn:query.isbn});
          if(payload.data?.editions?.some(e=>!Number.isSafeInteger(e.id)||e.id<=0||e.book_id!==e.book?.id)) throw new LookupError();
          result=normalizeHardcover(payload,query.isbn);
        }
        else {
          // Exact title equality is supported by the official GraphQL schema.
          // Unlike the fuzzy search index, related study guides cannot crowd
          // out a popular novel. The ninth row is a truncation sentinel.
          const exact=await request(EXACT_TITLE,{title:query.title,author:query.author});
          if(exact.errors || !Array.isArray(exact.data?.books)) throw new LookupError();
          if(exact.data.books.length>=9) result={found:false,ambiguous:true};
          else if(exact.data.books.length) result=normalizeCandidates(exact,query,exact.data.books.map(b=>b.id));
          else {
            const indexed=await request(SEARCH,{query:query.title+' '+query.author});
            if(indexed.errors) throw new LookupError();
            let matches=indexed.data?.search?.results;
            if(typeof matches==='string') matches=JSON.parse(matches);
            if(!matches || !Array.isArray(matches.hits) || !Number.isSafeInteger(matches.found) ||
               matches.found>25 || matches.hits.length!==matches.found || matches.search_cutoff===true) result={found:false,ambiguous:true};
            else {
              const ids=[...new Set(matches.hits.filter(hit=>normalizeIdentity(hit.document?.title)===normalizeIdentity(query.title) &&
                Array.isArray(hit.document?.author_names) && hit.document.author_names.some(a=>normalizeIdentity(a)===normalizeIdentity(query.author)))
                .map(hit=>Number(hit.document.id)))];
              if(ids.some(id=>!Number.isSafeInteger(id)||id<=0)) throw new LookupError();
              result=ids.length>8 ? {found:false,ambiguous:true} : ids.length ?
                normalizeCandidates(await request(DETAILS,{ids}),query,ids) : {found:false};
            }
          }
        }
        if (result.found) {
          if (!result.authors.length) throw new LookupError();
          if (result.rating===undefined) delete result.ratingsCount;
          result={...result,identity:query.isbn?'isbn':'work',ratingScope:'work',verified:true,
            retrievedAt:new Date(now()).toISOString(),matchEvidence:{method:query.isbn?'exact_isbn_parent_book':'exact_title_primary_author',...query}};
          await store.put(key,query,result);
        }
        await store.finish(key,result.found ? 7*86400 : 300);
        return {...result,cacheHit:false};
      } catch(error) {
        await store.finish(key,3600).catch(()=>{});
        throw error instanceof LookupError ? error : new LookupError();
      }
    })();
    pending.set(key,operation);
    try { return await operation; } finally { if(pending.get(key)===operation) pending.delete(key); }
  };
}
