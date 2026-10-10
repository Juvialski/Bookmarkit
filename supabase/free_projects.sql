create table public.gemini_project_usage (
 project_id text not null, model text not null, task text not null check(task in ('grounding','text')),
 day date not null, attempts integer not null default 0, tokens bigint not null default 0,
 cooldown_until timestamptz, last_attempt timestamptz, primary key(project_id,model,task,day)
);
create table public.gemini_circuit(id boolean primary key default true check(id), cooldown_until timestamptz);
alter table public.gemini_project_usage enable row level security;
alter table public.gemini_circuit enable row level security;
revoke all on public.gemini_project_usage,public.gemini_circuit from public,anon,authenticated;
grant select,insert,update on public.gemini_project_usage,public.gemini_circuit to service_role;
create function public.reserve_free_gemini(p_project text,p_model text,p_task text,p_limit integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer; quota_day date := (now() at time zone 'America/Los_Angeles')::date;
begin
 if p_limit is null or p_limit<1 or p_limit>20 then return false; end if;
 if exists(select 1 from public.gemini_circuit where cooldown_until>now()) then return false; end if;
 if not ((p_task='grounding' and p_model='gemini-2.5-flash-lite') or (p_task='text' and p_model in ('gemini-3.1-flash-lite','gemini-3.5-flash-lite'))) then return false; end if;
 insert into public.gemini_project_usage(project_id,model,task,day,attempts,last_attempt) values(p_project,p_model,p_task,quota_day,1,now())
 on conflict(project_id,model,task,day) do update set attempts=public.gemini_project_usage.attempts+1,last_attempt=now()
 where public.gemini_project_usage.attempts<p_limit and (public.gemini_project_usage.cooldown_until is null or public.gemini_project_usage.cooldown_until<=now())
 and public.gemini_project_usage.last_attempt<now()-interval '15 seconds' returning attempts into n;
 return n is not null;
end $$;
create function public.cooldown_free_gemini(p_project text,p_model text,p_task text,p_seconds integer) returns void
language plpgsql security invoker set search_path='' as $$ begin
 update public.gemini_project_usage set cooldown_until=now()+make_interval(secs=>least(greatest(p_seconds,60),86400)) where project_id=p_project and model=p_model and task=p_task;
 -- Enforced restriction pauses the entire optional Gemini route. Never rotate
 -- projects/keys to bypass a 429 or an eligibility restriction.
 insert into public.gemini_circuit(id,cooldown_until) values(true,now()+make_interval(secs=>least(greatest(p_seconds,60),86400))) on conflict(id) do update set cooldown_until=excluded.cooldown_until;
end $$;
create function public.record_free_gemini(p_project text,p_model text,p_task text,p_tokens integer) returns void
language sql security invoker set search_path='' as $$
 update public.gemini_project_usage set tokens=tokens+least(greatest(p_tokens,0),10000) where project_id=p_project and model=p_model and task=p_task and day=(now() at time zone 'America/Los_Angeles')::date;
$$;
revoke all on function public.reserve_free_gemini(text,text,text,integer),public.cooldown_free_gemini(text,text,text,integer),public.record_free_gemini(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_free_gemini(text,text,text,integer),public.cooldown_free_gemini(text,text,text,integer),public.record_free_gemini(text,text,text,integer) to service_role;
