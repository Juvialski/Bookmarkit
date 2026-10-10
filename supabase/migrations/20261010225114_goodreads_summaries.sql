begin;
create table if not exists public.goodreads_summaries (
 book_id text primary key check (book_id ~ '^[1-9][0-9]{0,15}$'),
 goodreads_work_id text check (goodreads_work_id ~ '^[1-9][0-9]{0,15}$'),
 work_id text not null references public.catalog_works(id),
 isbn13 text check (isbn13 ~ '^97[89][0-9]{10}$'),
 average numeric not null check (average > 0 and average <= 5),
 rating_count bigint not null check (rating_count > 0 and rating_count <= 9007199254740991),
 url text not null,
 rating_scope text not null check (rating_scope in ('edition','work')),
 series_name text, series_position text check (series_position ~ '^[0-9]+(\.[0-9]+)?$' and series_position::numeric > 0),
 retrieved_at timestamptz not null,
 match_confidence text not null check (match_confidence in ('exact_isbn','title_author')),
 evidence jsonb not null check (jsonb_typeof(evidence)='object' and evidence ? 'method'),
 status text not null default 'verified' check (status='verified'),
 check (url ~ ('^https://www\.goodreads\.com/book/show/' || book_id || '([-.][A-Za-z0-9_%.-]+)?$')),
 check (rating_scope='work' or isbn13 is not null),
 check ((series_name is null) = (series_position is null))
);
create index if not exists goodreads_work_lookup on public.goodreads_summaries(work_id,retrieved_at desc);
create index if not exists goodreads_isbn_lookup on public.goodreads_summaries(isbn13) where isbn13 is not null;
alter table public.goodreads_summaries enable row level security;
revoke all on public.goodreads_summaries from public, anon, authenticated;
grant select on public.goodreads_summaries to anon, authenticated;
grant all on public.goodreads_summaries to service_role;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='goodreads_summaries' and policyname='goodreads_read') then
  create policy goodreads_read on public.goodreads_summaries for select to anon,authenticated using (status='verified');
 end if;
end $$;

-- The laptop calls an authenticated Edge Function. Only its server credential
-- can invoke this RPC; it cannot modify any existing catalog identity/ratings.
create or replace function public.ingest_goodreads(records jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare r jsonb; accepted integer := 0; changed integer;
begin
 if jsonb_typeof(records)<>'array' or jsonb_array_length(records)>25 then raise exception 'invalid batch'; end if;
 for r in select value from jsonb_array_elements(records) loop
  if r->>'status' is distinct from 'verified' or coalesce(r->>'match_confidence','') not in ('exact_isbn','title_author')
     or (r->>'retrieved_at')::timestamptz > now()+interval '5 minutes'
     or not exists(select 1 from public.catalog_works w where w.id=r->>'work_id')
     or (r->>'isbn13' is not null and not exists(
       select 1 from public.catalog_isbns i join public.catalog_editions e on e.id=i.edition_id
       where i.isbn13=r->>'isbn13' and e.work_id=r->>'work_id'))
  then raise exception 'unverified catalog linkage'; end if;
  if r->>'match_confidence'='exact_isbn' and (r->>'isbn13' is null or r->'evidence'->>'matched_isbn' is distinct from r->>'isbn13')
  then raise exception 'missing ISBN evidence'; end if;
  if not exists(select 1 from public.catalog_works w where w.id=r->>'work_id'
    and lower(trim(w.title))=lower(trim(r->'evidence'->>'title'))
    and exists(select 1 from jsonb_array_elements_text(w.authors) a
      join jsonb_array_elements_text(r->'evidence'->'authors') b on lower(trim(a.value))=lower(trim(b.value))))
  then raise exception 'contradictory title or author evidence'; end if;
  if exists(select 1 from public.goodreads_summaries g where g.book_id=r->>'book_id' and
    (g.work_id is distinct from r->>'work_id' or g.isbn13 is distinct from r->>'isbn13'
      or g.goodreads_work_id is distinct from r->>'goodreads_work_id' or g.rating_scope is distinct from r->>'rating_scope'
      or g.url is distinct from r->>'url')) then raise exception 'identity conflict'; end if;
  insert into public.goodreads_summaries as current
   (book_id,goodreads_work_id,work_id,isbn13,average,rating_count,url,rating_scope,series_name,series_position,retrieved_at,match_confidence,evidence,status)
  values (r->>'book_id',r->>'goodreads_work_id',r->>'work_id',r->>'isbn13',(r->>'average')::numeric,
   (r->>'rating_count')::bigint,r->>'url',r->>'rating_scope',r->>'series_name',r->>'series_position',
   (r->>'retrieved_at')::timestamptz,r->>'match_confidence',r->'evidence','verified')
  on conflict(book_id) do update set average=excluded.average,rating_count=excluded.rating_count,
   retrieved_at=excluded.retrieved_at,evidence=excluded.evidence
  where current.work_id=excluded.work_id and current.isbn13 is not distinct from excluded.isbn13
   and current.goodreads_work_id is not distinct from excluded.goodreads_work_id
   and current.rating_scope=excluded.rating_scope and current.url=excluded.url
   and current.retrieved_at < excluded.retrieved_at;
  get diagnostics changed = row_count;
  accepted := accepted + changed;
 end loop;
 return accepted;
end $$;
revoke all on function public.ingest_goodreads(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_goodreads(jsonb) to service_role;
commit;
