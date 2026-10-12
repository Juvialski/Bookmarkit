-- All synthetic rows are rolled back; no provider calls or quota reservations.
begin;
set local role service_role;
do $$ declare k text:=repeat('9',64); r jsonb; n integer; begin
 r:=jsonb_build_object('found',true,'verified',true,'identity','work','hardcoverId','999999999999999',
  'title','Bookmarkit synthetic enrichment fixture','authors',jsonb_build_array('Synthetic Author'),
  'rating',4.21,'ratingsCount',1234,'ratingScope','work','retrievedAt',now());
 insert into public.hardcover_cache(cache_key,book_id,title,primary_author,payload,retrieved_at,expires_at)
 values(k,r->>'hardcoverId',r->>'title','Synthetic Author',r,now(),now()+interval '7 days');
 if not exists(select 1 from public.catalog_works where id='hardcover:999999999999999' and authors='["Synthetic Author"]'::jsonb) then raise exception 'verified title-only metadata not accepted'; end if;
 if not exists(select 1 from public.catalog_ratings where work_id='hardcover:999999999999999' and source='Hardcover' and average=4.21 and count=1234) then raise exception 'source pair changed'; end if;
 if exists(select 1 from public.catalog_editions where work_id='hardcover:999999999999999') then raise exception 'work-only observation invented edition'; end if;
 perform public.accept_hardcover_catalog(k);perform public.accept_hardcover_catalog(k);
 select count(*) into n from public.catalog_provider_works where provider_id='999999999999999';
 if n<>1 then raise exception 'non-idempotent acceptance'; end if;
 update public.hardcover_cache set payload=r||'{"seriesName":"Fixture Series","seriesPosition":"1"}'::jsonb where cache_key=k;
 if not exists(select 1 from public.catalog_works where id='hardcover:999999999999999' and series_status='series' and classification_source='hardcover') then raise exception 'independent series metadata lost'; end if;
 update public.hardcover_cache set payload=r||jsonb_build_object('rating',3.2,'ratingsCount',12,'retrievedAt',now()-interval '1 day'),retrieved_at=now()-interval '1 day' where cache_key=k;
 if not exists(select 1 from public.catalog_ratings where work_id='hardcover:999999999999999' and average=4.21 and count=1234) then raise exception 'older observation replaced newer'; end if;
 -- A conflicting same canonical provider identity cannot alter existing catalog.
 update public.hardcover_cache set title='Different work',payload=r||'{"title":"Different work"}'::jsonb where cache_key=k;
 if public.accept_hardcover_catalog(k) then raise exception 'identity conflict accepted'; end if;
 if not exists(select 1 from public.catalog_works where id='hardcover:999999999999999' and title='Bookmarkit synthetic enrichment fixture') then raise exception 'previous metadata lost'; end if;
end $$;
set local role anon;
do $$ begin
 if not exists(select 1 from public.catalog_provider_works where provider_id='999999999999999') then raise exception 'public mapping unreadable'; end if;
 begin perform public.accept_hardcover_catalog(repeat('9',64));raise exception 'public ingestion callable';exception when insufficient_privilege then null;end;
 begin delete from public.catalog_provider_works;raise exception 'anonymous writes allowed';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.accept_hardcover_catalog(repeat('9',64));raise exception 'authenticated ingestion callable';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'catalog metadata, pairing, stale preservation, conflict, idempotency and RLS passed' as result;
rollback;
