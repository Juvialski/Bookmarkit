create table public.grounding_usage(day date primary key, attempts integer not null default 0 check(attempts>=0));
alter table public.grounding_usage enable row level security;
revoke all on public.grounding_usage from public,anon,authenticated;
grant select,insert,update on public.grounding_usage to service_role;
create function public.reserve_grounding(daily_limit integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if daily_limit is null or daily_limit < 1 or daily_limit > 20 then return false; end if;
 insert into public.grounding_usage(day,attempts) values((now() at time zone 'UTC')::date,1)
 on conflict(day) do update set attempts=public.grounding_usage.attempts+1
 where public.grounding_usage.attempts < daily_limit returning attempts into n;
 return n is not null;
end $$;
revoke all on function public.reserve_grounding(integer) from public,anon,authenticated;
grant execute on function public.reserve_grounding(integer) to service_role;
