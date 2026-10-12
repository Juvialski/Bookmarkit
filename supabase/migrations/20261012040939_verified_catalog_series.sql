begin;
-- Classification uses structured series relationships independently of ratings.
create function public.sync_hardcover_series(provider_identity text)
returns void language plpgsql security invoker set search_path='' as $$
declare target text; c public.hardcover_cache; variants integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('hc:'||provider_identity,0));
 select work_id into target from public.catalog_provider_works where provider_id=provider_identity;
 if target is null then return; end if;
 select * into c from public.hardcover_cache where book_id=provider_identity order by retrieved_at desc,cache_key limit 1;
 if lower(trim(c.title))='warbreaker' and lower(trim(c.primary_author))='brandon sanderson' then return; end if;
 if not exists(select 1 from public.catalog_works w where w.id=target and lower(trim(w.title))=lower(trim(c.title))
  and exists(select 1 from jsonb_array_elements_text(w.authors) a where lower(trim(a.value))=lower(trim(c.primary_author)))) then return; end if;
 select count(distinct (payload->>'seriesName')||'|'||(payload->>'seriesPosition')) into variants
  from public.hardcover_cache where book_id=provider_identity and payload->>'seriesName' is not null;
 if variants>1 then
  update public.catalog_works set series_status='unknown',series_name=null,series_position=null,classification_source='unknown'
   where id=target and classification_source='hardcover';return;
 end if;
 if length(c.payload->>'seriesName') between 1 and 240 and c.payload->>'seriesPosition' ~ '^[0-9]+(\.[0-9]+)?$'
   and (c.payload->>'seriesPosition')::numeric>0 then
  update public.catalog_works set series_status='series',series_name=c.payload->>'seriesName',series_position=c.payload->>'seriesPosition',classification_source='hardcover'
   where id=target and series_status='unknown';
 end if;
end $$;
revoke all on function public.sync_hardcover_series(text) from public,anon,authenticated;
grant execute on function public.sync_hardcover_series(text) to service_role;
create function public.on_hardcover_series() returns trigger language plpgsql security invoker set search_path='' as $$
begin perform public.sync_hardcover_series(new.book_id);return new;end $$;
revoke all on function public.on_hardcover_series() from public,anon,authenticated;
grant execute on function public.on_hardcover_series() to service_role;
create trigger hardcover_catalog_series after insert or update on public.hardcover_cache for each row execute function public.on_hardcover_series();
commit;
