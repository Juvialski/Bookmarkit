-- Dedicated CI database; use the actual catalog schema, never a production reset.
create database bookmarkit_v5;
\connect bookmarkit_v5
create schema extensions;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
\ir ../migrations/20261010045758_central_catalog.sql
\ir ../migrations/20261011011808_hardcover_cache.sql
\ir ../migrations/20261011022322_hardcover_search_budget.sql
\ir ../migrations/20261012035132_verified_catalog_enrichment.sql
\ir ../migrations/20261012040939_verified_catalog_series.sql
\ir ../migrations/20261012042437_persistent_catalog_author_references.sql
\ir catalog-enrichment.sql
