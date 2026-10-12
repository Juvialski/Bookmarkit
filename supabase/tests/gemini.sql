-- Isolated contracts: no Google calls or production state.
begin;
set local role service_role;
do $$ begin
 perform public.cooldown_free_gemini('contract','gemini-2.5-flash-lite','grounding',120);
 if public.reserve_free_gemini('contract','gemini-2.5-flash-lite','grounding',5) then raise exception 'Grounding backoff ignored'; end if;
 if not public.reserve_free_gemini('contract','gemini-3.5-flash-lite','text',1) then raise exception 'Text incorrectly blocked'; end if;
 if public.reserve_free_gemini('contract','gemini-3.5-flash-lite','text',1) then raise exception 'Daily quota ignored'; end if;
 perform public.cooldown_free_gemini('config-contract','gemini-3.5-flash-lite','text',0);
 if public.reserve_free_gemini('config-contract','gemini-3.5-flash-lite','text',5) then raise exception 'Configuration block ignored'; end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.gemini_operation_circuit','INSERT') or
    has_table_privilege('authenticated','public.gemini_operation_circuit','INSERT') or
    has_function_privilege('anon','public.reserve_free_gemini(text,text,text,integer)','EXECUTE') then
    raise exception 'Public Gemini write access';
 end if;
end $$;
rollback;
