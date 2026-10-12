-- Preserve legacy restrictions until expiry; new failures are operation scoped.
create table public.gemini_operation_circuit (
 project_id text not null, model text not null, task text not null check(task in ('text','grounding')),
 cooldown_until timestamptz, disabled boolean not null default false,
 primary key(project_id,model,task)
);
alter table public.gemini_operation_circuit enable row level security;
revoke all on public.gemini_operation_circuit from public,anon,authenticated;
grant select,insert,update on public.gemini_operation_circuit to service_role;
insert into public.gemini_operation_circuit(project_id,model,task,cooldown_until)
select distinct u.project_id,u.model,u.task,g.cooldown_until from public.gemini_project_usage u cross join public.gemini_circuit g where g.cooldown_until>now();
create or replace function public.reserve_free_gemini(p_project text,p_model text,p_task text,p_limit integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer; quota_day date := (now() at time zone 'America/Los_Angeles')::date;
begin
 if p_limit is null or p_limit<1 or p_limit>20 then return false; end if;
 if exists(select 1 from public.gemini_operation_circuit where project_id=p_project and model=p_model and task=p_task and (disabled or cooldown_until>now())) then return false; end if;
 if not ((p_task='grounding' and p_model='gemini-2.5-flash-lite') or (p_task='text' and p_model in ('gemini-3.1-flash-lite','gemini-3.5-flash-lite'))) then return false; end if;
 insert into public.gemini_project_usage(project_id,model,task,day,attempts,last_attempt) values(p_project,p_model,p_task,quota_day,1,now())
 on conflict(project_id,model,task,day) do update set attempts=public.gemini_project_usage.attempts+1,last_attempt=now()
 where public.gemini_project_usage.attempts<p_limit and (public.gemini_project_usage.cooldown_until is null or public.gemini_project_usage.cooldown_until<=now())
 and public.gemini_project_usage.last_attempt<now()-interval '15 seconds' returning attempts into n;
 return n is not null;
end $$;
create or replace function public.cooldown_free_gemini(p_project text,p_model text,p_task text,p_seconds integer) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if p_seconds is null or p_seconds<0 then return; end if;
 insert into public.gemini_operation_circuit(project_id,model,task,cooldown_until,disabled)
 values(p_project,p_model,p_task,case when p_seconds>0 then now()+make_interval(secs=>p_seconds) end,p_seconds=0)
 on conflict(project_id,model,task) do update set
 cooldown_until=greatest(public.gemini_operation_circuit.cooldown_until,excluded.cooldown_until),
 disabled=public.gemini_operation_circuit.disabled or excluded.disabled;
end $$;
revoke all on function public.reserve_free_gemini(text,text,text,integer),public.cooldown_free_gemini(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_free_gemini(text,text,text,integer),public.cooldown_free_gemini(text,text,text,integer) to service_role;
