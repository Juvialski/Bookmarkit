begin;
create unique index catalog_provider_canonical_work on public.catalog_provider_works(work_id);
create or replace function public.accept_hardcover_catalog(cache_identity text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.hardcover_cache; w public.catalog_works; target text; edition text; claimed text; candidates integer; stamp timestamptz;
begin
 select * into c from public.hardcover_cache where cache_key=cache_identity;
 if not found or c.payload->>'verified'<>'true' or c.payload->>'ratingScope'<>'work'
   or jsonb_typeof(c.payload->'authors')<>'array' or jsonb_array_length(c.payload->'authors')=0
   or c.payload->>'title' is distinct from c.title or c.payload->'authors'->>0 is distinct from c.primary_author then return false; end if;
 stamp:=c.retrieved_at;
 -- Serialise canonical work and ISBN acceptance across cache keys/isolation workers.
 perform pg_advisory_xact_lock(hashtextextended('hc:'||c.book_id,0));
 if c.isbn13 is not null then
  perform pg_advisory_xact_lock(hashtextextended('isbn:'||c.isbn13,0));
  select e.work_id into claimed from public.catalog_isbns i join public.catalog_editions e on e.id=i.edition_id where i.isbn13=c.isbn13;
 end if;
 select work_id into target from public.catalog_provider_works where provider_id=c.book_id;
 if target is null then
  target:=c.ol_work_id;
  if target is null and claimed is not null then
   select * into w from public.catalog_works where id=claimed;
   if lower(trim(w.title))<>lower(trim(c.title)) or not exists(select 1 from jsonb_array_elements_text(w.authors) a where lower(trim(a.value))=lower(trim(c.primary_author))) then return false; end if;
   target:=claimed;
  end if;
  if target is null then
   select min(id),count(*) into target,candidates from public.catalog_works
    where lower(trim(title))=lower(trim(c.title)) and exists(select 1 from jsonb_array_elements_text(authors) a where lower(trim(a.value))=lower(trim(c.primary_author)));
   if candidates>1 then return false; end if;
  end if;
  target:=coalesce(target,'hardcover:'||c.book_id);
 end if;
 if claimed is not null and claimed<>target then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('catalog:'||target,0));
 if exists(select 1 from public.catalog_provider_works where work_id=target and provider_id<>c.book_id) then return false;end if;
 select * into w from public.catalog_works where id=target;
 if found and (lower(trim(w.title))<>lower(trim(c.title)) or not exists(select 1 from jsonb_array_elements_text(w.authors) a where lower(trim(a.value))=lower(trim(c.primary_author)))) then return false; end if;
 edition:=case when c.isbn13 is not null and c.payload->>'hardcoverEditionId' ~ '^[1-9][0-9]{0,15}$' then 'hardcover-edition:'||(c.payload->>'hardcoverEditionId') end;
 if edition is not null and exists(select 1 from public.catalog_editions where id=edition and work_id<>target) then return false; end if;
 insert into public.catalog_works(id,title,authors,normalized_title,source,source_updated)
 values(target,c.title,c.payload->'authors',trim(regexp_replace(lower(c.title),'[^[:alnum:]]+',' ','g')),'hardcover',stamp)
 on conflict(id) do nothing;
 insert into public.catalog_provider_works(provider_id,work_id,source_updated,url)
 values(c.book_id,target,stamp,case when c.payload->>'url' ~ '^https://hardcover.app/books/[a-z0-9-]+$' then c.payload->>'url' end)
 on conflict(provider_id) do update set source_updated=excluded.source_updated,url=excluded.url
 where public.catalog_provider_works.work_id=excluded.work_id and public.catalog_provider_works.source_updated<excluded.source_updated;
 if edition is not null and claimed is null then
  insert into public.catalog_editions(id,work_id,title,source_updated) values(edition,target,c.title,stamp) on conflict(id) do nothing;
  insert into public.catalog_isbns(isbn13,edition_id) values(c.isbn13,edition) on conflict(isbn13) do nothing;
 end if;
 if c.payload->>'rating' is not null and c.payload->>'ratingsCount' is not null and (c.payload->>'ratingsCount')::numeric<=2147483647 then
  insert into public.catalog_ratings(work_id,source,average,count,source_updated)
  values(target,'Hardcover',(c.payload->>'rating')::numeric,(c.payload->>'ratingsCount')::integer,stamp)
  on conflict(work_id,source) do update set average=excluded.average,count=excluded.count,source_updated=excluded.source_updated
  where public.catalog_ratings.source_updated<excluded.source_updated;
 end if;
 return true;
end $$;
revoke all on function public.accept_hardcover_catalog(text) from public,anon,authenticated;
grant execute on function public.accept_hardcover_catalog(text) to service_role;
commit;