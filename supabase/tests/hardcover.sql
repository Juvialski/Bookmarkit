-- Synthetic contract rows exist ONLY inside this rolled-back transaction.
begin;
set local role service_role;
do $$ declare k text:=repeat('a',64); r jsonb; begin
 r:=jsonb_build_object('found',true,'verified',true,'identity','isbn','isbn','9780765326355',
  'hardcoverId','123','title','Hardcover contract fixture','authors',jsonb_build_array('Fixture Writer'),
  'rating',4.56,'ratingsCount',18432,'ratingScope','work','retrievedAt',now());
 if not public.reserve_hardcover(k,'{"isbn":"9780765326355"}',1) then raise exception 'first reservation denied'; end if;
 if public.reserve_hardcover(k,'{"isbn":"9780765326355"}',1) then raise exception 'duplicate lease allowed'; end if;
 if public.reserve_hardcover(repeat('b',64),'{}',1) then raise exception 'spacing violated'; end if;
 perform public.put_hardcover(k,'{"isbn":"9780765326355"}',r);
 if not exists(select 1 from public.hardcover_cache where cache_key=k and expires_at>now() and ol_work_id is null) then raise exception 'cache contract failure'; end if;
 begin
  perform public.put_hardcover(k,'{"isbn":"9780765326355"}',r||'{"hardcoverId":"456"}'::jsonb);
  raise exception 'identity change allowed';
 exception when raise_exception then
  if sqlerrm<>'identity conflict' then raise; end if;
 end;
 perform public.finish_hardcover(k,604800);
 perform public.cooldown_hardcover(3600);
 if not exists(select 1 from public.hardcover_budget where cooldown_until>=now()+interval '1 hour') then raise exception 'cooldown not persisted'; end if;
 update public.hardcover_budget set used=499,next_allowed='epoch',cooldown_until='epoch';
 if public.reserve_hardcover(repeat('c',64),'{}',2) then raise exception 'daily budget exceeded'; end if;
 update public.hardcover_budget set used=0,next_allowed='epoch',cooldown_until='epoch';
 if not public.reserve_hardcover(repeat('e',64),'{"title":"lowercase title","author":"writer"}',3) then raise exception 'case-search reservation denied'; end if;
 if not exists(select 1 from public.hardcover_budget where used=3 and next_allowed>=now()+interval '9 seconds') then raise exception 'case-search budget not charged'; end if;
end $$;
set local role anon;
do $$ begin
 if not exists(select 1 from public.hardcover_cache where cache_key=repeat('a',64)) then raise exception 'public cache unreadable'; end if;
 begin
  delete from public.hardcover_cache;
  raise exception 'anon write allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.reserve_hardcover(repeat('d',64),'{}',1);
  raise exception 'anon privileged RPC allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform count(*) from public.hardcover_jobs;
  raise exception 'private queue visible';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'hardcover RLS, lease, spacing, budget, cooldown, identity and cache contracts passed' as result;
rollback;
