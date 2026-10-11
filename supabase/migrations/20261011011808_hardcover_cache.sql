begin;
create table public.hardcover_cache (
 cache_key text primary key check(cache_key ~ '^[a-f0-9]{64}$'),
 book_id text not null check(book_id ~ '^[1-9][0-9]{0,15}$'),
 isbn13 text check(isbn13 ~ '^97[89][0-9]{10}$'),
 ol_work_id text references public.catalog_works(id),
 title text not null check(length(title) between 1 and 240),
 primary_author text not null check(length(primary_author) between 1 and 160),
 payload jsonb not null check(jsonb_typeof(payload)='object' and payload @> '{"found":true,"verified":true,"ratingScope":"work"}'::jsonb
   and payload->>'hardcoverId' is not distinct from book_id),
 retrieved_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>retrieved_at),
 check(payload->>'isbn' is not distinct from isbn13),
 check((payload->>'rating' is null and payload->>'ratingsCount' is null) or
   ((payload->>'rating')::numeric between 0 and 5 and (payload->>'ratingsCount')::bigint>0))
);
create index hardcover_book_lookup on public.hardcover_cache(book_id);
create index hardcover_work_lookup on public.hardcover_cache(ol_work_id) where ol_work_id is not null;
create index hardcover_isbn_lookup on public.hardcover_cache(isbn13) where isbn13 is not null;
alter table public.hardcover_cache enable row level security;
revoke all on public.hardcover_cache from public,anon,authenticated;
grant select on public.hardcover_cache to anon,authenticated;
grant all on public.hardcover_cache to service_role;
create policy hardcover_public_read on public.hardcover_cache for select to anon,authenticated using(true);

-- Private operator queue and global safety circuit. No raw scans or identities.
create table public.hardcover_jobs (
 cache_key text primary key check(cache_key ~ '^[a-f0-9]{64}$'),
 query jsonb not null, priority smallint not null default 0 check(priority between 0 and 3),
 requested_at timestamptz not null default now(), lease_until timestamptz,
 next_attempt timestamptz not null default now(), attempts integer not null default 0
);
create index hardcover_due_jobs on public.hardcover_jobs(priority,next_attempt);
create table public.hardcover_budget (
 id boolean primary key default true check(id), day date not null,
 used integer not null default 0 check(used between 0 and 500),
 next_allowed timestamptz not null default now(), cooldown_until timestamptz not null default now()
);
alter table public.hardcover_jobs enable row level security;
alter table public.hardcover_budget enable row level security;
revoke all on public.hardcover_jobs,public.hardcover_budget from public,anon,authenticated;
grant all on public.hardcover_jobs,public.hardcover_budget to service_role;
insert into public.hardcover_budget(id,day) values(true,(now() at time zone 'UTC')::date);

create function public.reserve_hardcover(key text, request jsonb, cost integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.hardcover_budget; j public.hardcover_jobs; current_day date := (now() at time zone 'UTC')::date;
begin
 if key !~ '^[a-f0-9]{64}$' or cost not in(1,2) or jsonb_typeof(request)<>'object' then raise exception 'invalid reservation'; end if;
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
create function public.finish_hardcover(key text, seconds integer)
returns void language sql security invoker set search_path='' as $$
 update public.hardcover_jobs set lease_until=null,next_attempt=now()+least(greatest(seconds,300),604800)*interval '1 second',
  priority=case when seconds=604800 then 2 else priority end,attempts=case when seconds=604800 then 0 else attempts end where cache_key=key;
$$;
create function public.cooldown_hardcover(seconds integer)
returns void language sql security invoker set search_path='' as $$
 update public.hardcover_budget set cooldown_until=greatest(cooldown_until,now()+least(greatest(seconds,60),86400)*interval '1 second') where id=true;
$$;
-- Immutable identity on conflict. Complete rating/count observations replace
-- only older observations for this exact query/work identity.
create function public.put_hardcover(key text, request jsonb, record jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare old public.hardcover_cache; linked text; candidates integer;
begin
 if not(record @> '{"found":true,"verified":true,"ratingScope":"work"}'::jsonb)
  or (record->>'retrievedAt')::timestamptz>now()+interval '5 minutes'
  or record->>'isbn' is distinct from request->>'isbn' then raise exception 'invalid observation'; end if;
 if request->>'isbn' is not null then
  -- Independently map OL only via an existing ISBN/edition/catalog identity.
  select min(w.id),count(*) into linked,candidates from public.catalog_isbns i
   join public.catalog_editions e on e.id=i.edition_id join public.catalog_works w on w.id=e.work_id
   where i.isbn13=request->>'isbn' and lower(trim(w.title))=lower(trim(record->>'title'))
   and exists(select 1 from jsonb_array_elements_text(w.authors) a where lower(trim(a.value))=lower(trim(record->'authors'->>0)));
  if candidates<>1 then linked:=null; end if;
 end if;
 select * into old from public.hardcover_cache where cache_key=key for update;
 if found and (old.book_id<>record->>'hardcoverId' or old.isbn13 is distinct from request->>'isbn'
   or old.title<>record->>'title' or old.primary_author<>record->'authors'->>0) then raise exception 'identity conflict'; end if;
 insert into public.hardcover_cache(cache_key,book_id,isbn13,ol_work_id,title,primary_author,payload,retrieved_at,expires_at)
 values(key,record->>'hardcoverId',request->>'isbn',linked,record->>'title',record->'authors'->>0,record,
  (record->>'retrievedAt')::timestamptz,(record->>'retrievedAt')::timestamptz+interval '7 days')
 on conflict(cache_key) do update set payload=excluded.payload,retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at
 where public.hardcover_cache.retrieved_at<excluded.retrieved_at;
end $$;
revoke all on function public.reserve_hardcover(text,jsonb,integer),public.finish_hardcover(text,integer),public.cooldown_hardcover(integer),public.put_hardcover(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_hardcover(text,jsonb,integer),public.finish_hardcover(text,integer),public.cooldown_hardcover(integer),public.put_hardcover(text,jsonb,jsonb) to service_role;
commit;
