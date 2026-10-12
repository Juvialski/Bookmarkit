-- Configuration fingerprints are one-way hashes computed only in the backend.
alter table public.gemini_operation_circuit add column configuration_hash text not null default '';
create function public.reserve_free_gemini(p_project text,p_model text,p_task text,p_limit integer,p_configuration text) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 if p_configuration is null or p_configuration !~ '^[a-f0-9]{64}$' then return false; end if;
 insert into public.gemini_operation_circuit(project_id,model,task,configuration_hash)
 values(p_project,p_model,p_task,p_configuration)
 on conflict(project_id,model,task) do update set
 disabled=case when public.gemini_operation_circuit.configuration_hash<>'' and public.gemini_operation_circuit.configuration_hash<>excluded.configuration_hash then false else public.gemini_operation_circuit.disabled end,
 configuration_hash=excluded.configuration_hash;
 -- Keep provider timed backoff and actual project/model daily usage across changes.
 return public.reserve_free_gemini(p_project,p_model,p_task,p_limit);
end $$;
create function public.cooldown_free_gemini(p_project text,p_model text,p_task text,p_seconds integer,p_configuration text) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if p_configuration is null or p_configuration !~ '^[a-f0-9]{64}$' then return; end if;
 perform public.cooldown_free_gemini(p_project,p_model,p_task,p_seconds);
 update public.gemini_operation_circuit set configuration_hash=p_configuration where project_id=p_project and model=p_model and task=p_task;
end $$;
revoke all on function public.reserve_free_gemini(text,text,text,integer,text),public.cooldown_free_gemini(text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_free_gemini(text,text,text,integer,text),public.cooldown_free_gemini(text,text,text,integer,text) to service_role;
