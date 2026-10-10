create extension if not exists pg_trgm with schema extensions;
create table public.catalog_works (
 id text primary key, title text not null, authors jsonb not null default '[]',
 normalized_title text not null, cover_url text,
 series_status text not null default 'unknown' check (series_status in ('series','standalone','unknown')),
 series_name text, series_position text, classification_source text not null default 'unknown',
 source text not null check (source = 'open-library'), source_updated timestamptz not null,
 check (series_status <> 'series' or (series_name is not null and series_position is not null)),
 check (series_status <> 'standalone' or classification_source = 'curated')
);
create index catalog_title_trgm on public.catalog_works using gin (normalized_title extensions.gin_trgm_ops);
create index catalog_author_search on public.catalog_works using gin (to_tsvector('simple', title || ' ' || authors::text));
create table public.catalog_authors (id text primary key, name text not null, source_updated timestamptz not null);
create table public.catalog_work_authors (
 work_id text references public.catalog_works on delete cascade, author_id text references public.catalog_authors,
 primary key(work_id,author_id)
);
create index catalog_author_works on public.catalog_work_authors(author_id);
create table public.catalog_editions (
 id text primary key, work_id text not null references public.catalog_works, title text not null,
 source_updated timestamptz not null
);
create index catalog_editions_work on public.catalog_editions(work_id);
create table public.catalog_isbns (
 isbn13 text primary key check (isbn13 ~ '^97[89][0-9]{10}$'),
 isbn10 text check (isbn10 ~ '^[0-9]{9}[0-9X]$'), edition_id text not null references public.catalog_editions
);
create index catalog_isbn10 on public.catalog_isbns(isbn10) where isbn10 is not null;
create index catalog_isbn_edition on public.catalog_isbns(edition_id);
create table public.catalog_ratings (
 work_id text references public.catalog_works, source text check (source = 'Open Library'),
 average numeric check (average > 0 and average <= 5), count integer check (count > 0),
 source_updated timestamptz not null, primary key(work_id,source)
);
create table public.catalog_manifests (
 version text primary key, schema_version text not null, works integer not null check(works > 0),
 isbns integer not null check(isbns > 0), bytes bigint not null check(bytes > 0 and bytes <= 100000000),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), url text not null check(url like 'https://%'),
 published_at timestamptz not null default now()
);
create table public.catalog_ingestion (
 id bigint generated always as identity primary key, version text not null,
 sources jsonb not null, started_at timestamptz not null default now(), completed_at timestamptz,
 works integer, isbns integer, status text not null check(status in ('running','validated','published','failed'))
);
do $$ declare t text; begin
 foreach t in array array['catalog_works','catalog_authors','catalog_work_authors','catalog_editions','catalog_isbns','catalog_ratings','catalog_manifests','catalog_ingestion'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  if t <> 'catalog_ingestion' then
   execute format('grant select on public.%I to anon, authenticated',t);
   execute format('create policy catalog_read on public.%I for select to anon, authenticated using (true)',t);
  end if;
 end loop;
end $$;
create function public.search_catalog(isbn text default null, query text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
 select coalesce(jsonb_agg(result),'[]'::jsonb) from (
 select jsonb_build_object('identity',case when isbn is null then 'work' else 'isbn' end,
 'isbn',isbn,'workId',w.id,'title',w.title,'authors',w.authors,'coverUrl',w.cover_url,
 'seriesStatus',w.series_status,'seriesName',w.series_name,'seriesPosition',w.series_position,
 'classificationSource',w.classification_source,
 'ratings',case when r.average is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('provider',r.source,'average',r.average,'count',r.count)) end,
 'warnings','[]'::jsonb) as result
 from public.catalog_works w left join public.catalog_ratings r on r.work_id=w.id
 where (isbn is not null and exists(select 1 from public.catalog_editions e join public.catalog_isbns i on i.edition_id=e.id where e.work_id=w.id and i.isbn13=isbn))
 or (isbn is null and length(query) between 2 and 240 and to_tsvector('simple',w.title || ' ' || w.authors::text) @@ plainto_tsquery('simple',query))
 order by w.id limit 12
 ) matches
$$;
revoke all on function public.search_catalog(text,text) from public;
grant execute on function public.search_catalog(text,text) to anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('book-catalogs','book-catalogs',true,100000000,array['application/octet-stream','application/json'])
on conflict(id) do nothing;
