begin;
-- Concurrent/resumed monthly jobs cannot erase previously resolved metadata.
create function public.merge_catalog_works(records jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.catalog_works;
begin
 if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>500 then raise exception 'invalid work batch';end if;
 for r in select * from jsonb_populate_recordset(null::public.catalog_works,records) loop
  if r.id is null or r.id !~ '^/works/OL[0-9]+W$' or r.title is null or r.source is distinct from 'open-library'
   or jsonb_typeof(r.authors) is distinct from 'array' or r.source_updated is null then raise exception 'invalid catalog work';end if;
  if exists(select 1 from public.catalog_works w where w.id=r.id and lower(trim(w.title))<>lower(trim(r.title))) then raise exception 'catalog identity conflict';end if;
  insert into public.catalog_works(id,title,authors,normalized_title,source,source_updated,series_status,series_name,series_position,classification_source)
  values(r.id,r.title,r.authors,r.normalized_title,r.source,r.source_updated,r.series_status,r.series_name,r.series_position,r.classification_source)
  on conflict(id) do update set
   authors=case when public.catalog_works.authors='[]'::jsonb or
    (public.catalog_works.authors <@ excluded.authors and excluded.source_updated>=public.catalog_works.source_updated) then excluded.authors else public.catalog_works.authors end,
   source_updated=greatest(public.catalog_works.source_updated,excluded.source_updated),
   series_status=case when public.catalog_works.series_status='unknown' then excluded.series_status else public.catalog_works.series_status end,
   series_name=case when public.catalog_works.series_status='unknown' then excluded.series_name else public.catalog_works.series_name end,
   series_position=case when public.catalog_works.series_status='unknown' then excluded.series_position else public.catalog_works.series_position end,
   classification_source=case when public.catalog_works.series_status='unknown' then excluded.classification_source else public.catalog_works.classification_source end;
 end loop;
end $$;
create function public.merge_catalog_ratings(records jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.catalog_ratings;
begin
 if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>500 then raise exception 'invalid rating batch';end if;
 for r in select * from jsonb_populate_recordset(null::public.catalog_ratings,records) loop
  if r.source is distinct from 'Open Library' or r.source_updated is null then raise exception 'invalid rating source';end if;
  insert into public.catalog_ratings values(r.work_id,r.source,r.average,r.count,r.source_updated)
  on conflict(work_id,source) do update set average=excluded.average,count=excluded.count,source_updated=excluded.source_updated
   where public.catalog_ratings.source_updated<=excluded.source_updated;
 end loop;
end $$;
revoke all on function public.merge_catalog_works(jsonb),public.merge_catalog_ratings(jsonb) from public,anon,authenticated;
grant execute on function public.merge_catalog_works(jsonb),public.merge_catalog_ratings(jsonb) to service_role;
commit;
