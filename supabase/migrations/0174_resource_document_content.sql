-- ============================================================================
-- Green Dog Ops — 0174 Policy / protocol document CONTENT
-- ----------------------------------------------------------------------------
-- resource_document only ever stored METADATA (title, category, link or file),
-- so nothing in the app could answer "what is the tardy policy?". This stores
-- the extracted TEXT of each document, chunked and full-text indexed, and
-- exposes one search function that Smart Report calls before it plans a query.
--
-- Retrieval deliberately goes through its own RPC rather than letting the model
-- write SQL against these tables: smart_query() rejects a statement containing
-- words like "create" or "grant", and a policy question ("how do I create a
-- hazard report?") would put that word inside the search literal and be
-- refused. Same safety posture as smart_query — SECURITY INVOKER, STABLE, and
-- EXECUTE granted only to service_role so the browser cannot reach it.
-- ============================================================================
set search_path = greendogops, public;

-- Where the text came from, so a re-sync can find the same Google file.
alter table greendogops.resource_document
  add column if not exists google_file_id text,
  add column if not exists content_synced_at timestamptz;

create unique index if not exists resource_document_google_file_id_key
  on greendogops.resource_document (google_file_id)
  where google_file_id is not null;

-- ---------------------------------------------------------------------------
-- Chunks. One row per ~1.5k characters of document text; the generated tsvector
-- is what the GIN index serves.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.resource_document_chunk (
  id           bigint generated always as identity primary key,
  document_id  uuid not null
                 references greendogops.resource_document(id) on delete cascade,
  chunk_index  integer not null,
  content      text not null,
  tsv          tsvector generated always as (to_tsvector('english', content)) stored,
  created_at   timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists resource_document_chunk_tsv_idx
  on greendogops.resource_document_chunk using gin (tsv);

create index if not exists resource_document_chunk_document_idx
  on greendogops.resource_document_chunk (document_id);

comment on table greendogops.resource_document_chunk is
  'Extracted text of resource_document rows, chunked for full-text retrieval.';

-- ---------------------------------------------------------------------------
-- Ranked passage search across every active document.
-- ---------------------------------------------------------------------------
create or replace function greendogops.search_resource_content(
  p_query text,
  p_limit integer default 8
)
returns table (
  document_id uuid,
  title       text,
  category    text,
  source_url  text,
  chunk_index integer,
  content     text,
  rank        real
)
language sql
stable
security invoker
set search_path = greendogops, public
as $$
  select d.id, d.title, d.category, d.source_url, c.chunk_index, c.content,
         ts_rank(c.tsv, q.query) as rank
  from greendogops.resource_document_chunk c
  join greendogops.resource_document d on d.id = c.document_id
  cross join websearch_to_tsquery('english', coalesce(p_query, '')) as q(query)
  where d.is_active
    and c.tsv @@ q.query
  order by rank desc, d.title, c.chunk_index
  limit greatest(1, least(coalesce(p_limit, 8), 25));
$$;

revoke all on function greendogops.search_resource_content(text, integer) from public;
grant execute on function greendogops.search_resource_content(text, integer) to service_role;

grant select, insert, update, delete on greendogops.resource_document_chunk to service_role;
grant select on greendogops.resource_document_chunk to authenticated;
