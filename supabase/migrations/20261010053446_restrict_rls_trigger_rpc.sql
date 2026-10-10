-- The platform event trigger runs as its owner; clients must not execute it.
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
