begin;
create table public.catalog_work_links (
 alias_work_id text primary key references public.catalog_works(id),
 canonical_work_id text not null references public.catalog_works(id),
 isbn13 text not null references public.catalog_isbns(isbn13),
 source_edition text not null check(source_edition ~ '^/books/OL[0-9]+M$'),
 verified_at timestamptz not null default now(),check(alias_work_id<>canonical_work_id)
);
create index catalog_work_link_parent on public.catalog_work_links(canonical_work_id);
alter table public.catalog_work_links enable row level security;
revoke all on public.catalog_work_links from public,anon,authenticated;
grant select on public.catalog_work_links to anon,authenticated;
grant all on public.catalog_work_links to service_role;
create policy catalog_work_link_read on public.catalog_work_links for select to anon,authenticated using(true);
create function public.accept_catalog_work_link(cache_identity text,edition jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.hardcover_cache; parent text; existing text;
begin
 if jsonb_typeof(edition) is distinct from 'object' or edition->>'key' is null or edition->>'work_id' is null or edition->>'title' is null or edition->>'isbn13' is null then return false;end if;
 select * into c from public.hardcover_cache where cache_key=cache_identity;
 if not found or c.isbn13 is null or c.isbn13 is distinct from edition->>'isbn13'
  or edition->>'key' !~ '^/books/OL[0-9]+M$' then return false;end if;
 select work_id into parent from public.catalog_provider_works where provider_id=c.book_id;
 if parent is null or not exists(select 1 from public.catalog_works where id=parent and source='hardcover') then return false;end if;
 if not exists(select 1 from public.catalog_works w where id=edition->>'work_id' and source='open-library'
  and lower(trim(title))=lower(trim(c.title)) and exists(select 1 from jsonb_array_elements_text(w.authors) a where lower(trim(a.value))=lower(trim(c.primary_author))))
  or lower(trim(edition->>'title'))<>lower(trim(c.title)) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('alias:'||(edition->>'work_id'),0));
 select canonical_work_id into existing from public.catalog_work_links where alias_work_id=edition->>'work_id';
 if existing is not null then return existing=parent;end if;
 insert into public.catalog_work_links(alias_work_id,canonical_work_id,isbn13,source_edition)
 values(edition->>'work_id',parent,c.isbn13,edition->>'key');return true;
end $$;
revoke all on function public.accept_catalog_work_link(text,jsonb) from public,anon,authenticated;
grant execute on function public.accept_catalog_work_link(text,jsonb) to service_role;
commit;
create or replace function public.search_catalog(isbn text default null, query text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(result),'[]'::jsonb) from (
 select jsonb_build_object('identity',case when isbn is null then 'work' else 'isbn' end,
 'isbn',isbn,'workId',w.id,'title',w.title,'authors',w.authors,'coverUrl',w.cover_url,
 'seriesStatus',w.series_status,'seriesName',w.series_name,'seriesPosition',w.series_position,
 'classificationSource',w.classification_source,
 'hardcoverId',(select p.provider_id from public.catalog_provider_works p where p.work_id=coalesce(link.canonical_work_id,w.id) order by p.provider_id limit 1),
 'hardcoverUrl',(select p.url from public.catalog_provider_works p where p.work_id=coalesce(link.canonical_work_id,w.id) order by p.provider_id limit 1),
 'ratings',coalesce((select jsonb_agg(jsonb_build_object('provider',r.source,'average',r.average,'count',r.count,'scope','work','verified',true,'stored',true,'retrievedAt',r.source_updated)) from public.catalog_ratings r where r.work_id=w.id),'[]'::jsonb),
 'warnings','[]'::jsonb) as result
 from public.catalog_works w left join public.catalog_work_links link on link.alias_work_id=w.id
 where (isbn is not null and exists(select 1 from public.catalog_editions e join public.catalog_isbns i on i.edition_id=e.id where e.work_id=w.id and i.isbn13=isbn))
 or (isbn is null and length(query) between 2 and 240 and to_tsvector('simple',w.title || ' ' || w.authors::text) @@ plainto_tsquery('simple',query))
 order by w.id limit 12) matches
$$;

