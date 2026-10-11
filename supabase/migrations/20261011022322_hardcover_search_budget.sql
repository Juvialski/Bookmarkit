begin;
-- Reserve the worst-case three read-only fields for case-normalized search.
create or replace function public.reserve_hardcover(key text, request jsonb, cost integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.hardcover_budget; j public.hardcover_jobs; current_day date := (now() at time zone 'UTC')::date;
begin
 if key !~ '^[a-f0-9]{64}$' or cost not in(1,2,3) or jsonb_typeof(request)<>'object' then raise exception 'invalid reservation'; end if;
 select * into b from public.hardcover_budget where id=true for update;
 if b.day<>current_day then
  update public.hardcover_budget set day=current_day,used=0 where id=true; b.used:=0;
 end if;
 if not exists(select 1 from public.hardcover_jobs where cache_key=key) and (select count(*) from public.hardcover_jobs)>=2000 then return false; end if;
 insert into public.hardcover_jobs(cache_key,query) values(key,request) on conflict(cache_key) do nothing;
 select * into j from public.hardcover_jobs where cache_key=key for update;
 if j.lease_until>now() or j.next_attempt>now() or b.next_allowed>now() or b.cooldown_until>now() or b.used+cost>500 then return false; end if;
 update public.hardcover_budget set used=used+cost,next_allowed=now()+cost*interval '3 seconds' where id=true;
 update public.hardcover_jobs set query=request,lease_until=now()+interval '15 seconds',attempts=attempts+1 where cache_key=key;
 return true;
end $$;
commit;
