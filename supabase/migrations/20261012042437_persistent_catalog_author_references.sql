begin;
alter table public.catalog_works add column author_refs jsonb not null default '[]'::jsonb
 check(jsonb_typeof(author_refs)='array' and jsonb_array_length(author_refs)<=100);
create function public.retain_catalog_author_refs(records jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare r jsonb; n integer:=0;
begin
 if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>500 then raise exception 'invalid reference batch';end if;
 for r in select value from jsonb_array_elements(records) loop
  if jsonb_typeof(r) is distinct from 'object' or r->>'id' is null or r->'refs' is null then raise exception 'invalid author reference';end if;
  if r->>'id' !~ '^/works/OL[0-9]+W$' or jsonb_typeof(r->'refs')<>'array' or jsonb_array_length(r->'refs')>100
   or exists(select 1 from jsonb_array_elements(r->'refs') a where jsonb_typeof(a.value)<>'string' or a.value#>>'{}' !~ '^/authors/OL[0-9]+A$') then raise exception 'invalid author reference';end if;
  update public.catalog_works set author_refs=r->'refs' where id=r->>'id' and source='open-library'
   and author_refs='[]'::jsonb and jsonb_array_length(r->'refs')>0;
  if found then n:=n+1;end if;
 end loop;
 return n;
end $$;
revoke all on function public.retain_catalog_author_refs(jsonb) from public,anon,authenticated;
grant execute on function public.retain_catalog_author_refs(jsonb) to service_role;
commit;
