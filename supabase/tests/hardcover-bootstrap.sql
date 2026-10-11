-- Isolated CI database only. Existing production catalog remains untouched.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.catalog_works(id text primary key,title text,authors jsonb);
create table public.catalog_editions(id text primary key,work_id text references public.catalog_works(id));
create table public.catalog_isbns(isbn13 text primary key,edition_id text references public.catalog_editions(id));
grant select on public.catalog_works,public.catalog_editions,public.catalog_isbns to service_role;
