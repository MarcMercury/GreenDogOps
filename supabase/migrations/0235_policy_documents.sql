-- ============================================================================
-- Green Dog Ops — 0235 Native policy documents: access, versions, signatures
-- ----------------------------------------------------------------------------
-- Policies move out of Google Docs into Ops. A resource_document can now hold
-- its own rich-text body (TipTap JSON) next to the existing uploaded-file and
-- external-link kinds, and every document gains:
--
--   * Access control  — visible_roles (NULL = everyone) plus named people in
--                       resource_document_viewer. HR / Manager and above see
--                       every document so they can manage them.
--   * Versions        — each save is an immutable snapshot, so a signature is
--                       always tied to the exact text that was signed.
--   * Signatures      — initials + date per user per version. These rows ARE the
--                       HR record shown on the employee's Documents tab; they
--                       snapshot the signer and title and block deleting the
--                       document (archive it instead).
--
-- RLS is tightened, never relaxed: reads follow document visibility and every
-- write goes through Server Actions on the service-role client. Ask Ziggy's
-- passage search now takes the asker and only returns documents they can see.
-- The visibility rule is mirrored in src/lib/resources/access.ts.
-- ============================================================================
begin;
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. resource_document: native body, access, signature requirement
-- ---------------------------------------------------------------------------
alter table greendogops.resource_document
  add column if not exists content_json jsonb,
  add column if not exists content_text text,
  add column if not exists visible_roles text[],
  add column if not exists current_version integer not null default 0,
  add column if not exists require_signature boolean not null default false,
  add column if not exists signature_from_version integer,
  add column if not exists superseded_by uuid
    references greendogops.resource_document(id) on delete set null,
  add column if not exists updated_by uuid;

alter table greendogops.resource_document
  drop constraint if exists resource_document_has_target;
alter table greendogops.resource_document
  add constraint resource_document_has_target
    check (storage_path is not null or source_url is not null or content_json is not null);

alter table greendogops.resource_document
  drop constraint if exists resource_document_content_json_object;
alter table greendogops.resource_document
  add constraint resource_document_content_json_object
    check (content_json is null or jsonb_typeof(content_json) = 'object');

alter table greendogops.resource_document
  drop constraint if exists resource_document_visible_roles_valid;
alter table greendogops.resource_document
  add constraint resource_document_visible_roles_valid
    check (visible_roles is null or visible_roles <@ array[
      'owner', 'admin', 'executive', 'manager',
      'schedule_admin', 'marketing_admin', 'staff'
    ]::text[]);

alter table greendogops.resource_document
  drop constraint if exists resource_document_signature_baseline;
alter table greendogops.resource_document
  add constraint resource_document_signature_baseline
    check (
      not require_signature
      or (signature_from_version is not null
          and signature_from_version between 1 and greatest(current_version, 1))
    );

comment on column greendogops.resource_document.content_json is
  'Native document body (TipTap/ProseMirror JSON). NULL for uploaded files and external links.';
comment on column greendogops.resource_document.content_text is
  'Plain text of content_json, kept for search and Ask Ziggy chunks.';
comment on column greendogops.resource_document.visible_roles is
  'app_role values that may view. NULL = everyone; {} = only the people in resource_document_viewer. HR / Manager and above always see every document.';
comment on column greendogops.resource_document.signature_from_version is
  'Signatures on this version or later count as current. Raised when an editor asks everyone to re-sign.';
comment on column greendogops.resource_document.superseded_by is
  'Set when this row was replaced (e.g. a PDF/Google link converted to a native document). The row is kept, inactive.';

-- ---------------------------------------------------------------------------
-- 2. Named viewers
-- ---------------------------------------------------------------------------
create table if not exists greendogops.resource_document_viewer (
  document_id uuid not null
    references greendogops.resource_document(id) on delete cascade,
  app_user_id uuid not null
    references greendogops.app_user(id) on delete cascade,
  added_by    uuid,
  created_at  timestamptz not null default now(),
  primary key (document_id, app_user_id)
);

create index if not exists resource_document_viewer_user_idx
  on greendogops.resource_document_viewer (app_user_id);

comment on table greendogops.resource_document_viewer is
  'People who may view a resource_document in addition to its visible_roles.';

-- ---------------------------------------------------------------------------
-- 3. Versions (immutable snapshots)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.resource_document_version (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null
                       references greendogops.resource_document(id) on delete cascade,
  version_no         integer not null check (version_no >= 1),
  title              text not null,
  content_json       jsonb,
  content_text       text,
  storage_path       text,
  file_name          text,
  mime_type          text,
  size_bytes         bigint,
  change_note        text check (change_note is null or length(change_note) <= 500),
  signature_required boolean not null default false,
  notified_count     integer not null default 0 check (notified_count >= 0),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  unique (document_id, version_no),
  check (content_json is not null or storage_path is not null)
);

comment on table greendogops.resource_document_version is
  'Immutable snapshot of a resource_document per save. Signatures point here.';

-- ---------------------------------------------------------------------------
-- 4. Signatures (the HR record)
-- ---------------------------------------------------------------------------
create table if not exists greendogops.resource_document_signature (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null
                   references greendogops.resource_document(id) on delete restrict,
  version_id     uuid not null
                   references greendogops.resource_document_version(id) on delete restrict,
  version_no     integer not null,
  document_title text not null,
  app_user_id    uuid references greendogops.app_user(id) on delete set null,
  person_id      uuid references greendogops.person(id) on delete set null,
  signer_name    text not null,
  signer_email   text,
  initials       text not null check (initials ~ '^[A-Za-z][A-Za-z.''\- ]{0,9}$'),
  signed_on      date not null,
  signed_at      timestamptz not null default now(),
  user_agent     text check (user_agent is null or length(user_agent) <= 400),
  unique (version_id, app_user_id)
);

create index if not exists resource_document_signature_document_idx
  on greendogops.resource_document_signature (document_id, version_no desc);
create index if not exists resource_document_signature_person_idx
  on greendogops.resource_document_signature (person_id, signed_at desc);
create index if not exists resource_document_signature_user_idx
  on greendogops.resource_document_signature (app_user_id);

comment on table greendogops.resource_document_signature is
  'Initials + date acknowledgement of one resource_document version. Shown on the HR profile Documents tab. Service-role writes only.';

-- ---------------------------------------------------------------------------
-- 5. RLS — reads follow visibility; writes are service-role only
-- ---------------------------------------------------------------------------
alter table greendogops.resource_document_viewer    enable row level security;
alter table greendogops.resource_document_version   enable row level security;
alter table greendogops.resource_document_signature enable row level security;
-- protect_new_objects() adds a permissive gdo_members_all to every new table;
-- these tables get narrower policies instead.
drop policy if exists gdo_members_all on greendogops.resource_document_viewer;
drop policy if exists gdo_members_all on greendogops.resource_document_version;
drop policy if exists gdo_members_all on greendogops.resource_document_signature;

drop policy if exists gdo_members_all on greendogops.resource_document;
drop policy if exists resource_document_read on greendogops.resource_document;
create policy resource_document_read on greendogops.resource_document
  for select to authenticated
  using (
    greendogops.is_gdo_user()
    and (
      visible_roles is null
      or exists (
        select 1 from greendogops.app_user u
         where u.id = auth.uid() and u.is_active
           and (u.role::text in ('owner', 'admin', 'executive', 'manager')
                or u.role::text = any (resource_document.visible_roles))
      )
      or exists (
        select 1 from greendogops.resource_document_viewer v
         where v.document_id = resource_document.id
           and v.app_user_id = auth.uid()
      )
    )
  );

drop policy if exists gdo_members_all on greendogops.resource_document_chunk;
drop policy if exists resource_document_chunk_read on greendogops.resource_document_chunk;
create policy resource_document_chunk_read on greendogops.resource_document_chunk
  for select to authenticated
  using (
    greendogops.is_gdo_user()
    and exists (select 1 from greendogops.resource_document d
                 where d.id = resource_document_chunk.document_id)
  );

drop policy if exists resource_document_viewer_read on greendogops.resource_document_viewer;
create policy resource_document_viewer_read on greendogops.resource_document_viewer
  for select to authenticated
  using (
    greendogops.is_gdo_user()
    and (
      app_user_id = auth.uid()
      or exists (select 1 from greendogops.app_user u
                  where u.id = auth.uid() and u.is_active
                    and u.role::text in ('owner', 'admin', 'executive', 'manager'))
    )
  );

drop policy if exists resource_document_version_read on greendogops.resource_document_version;
create policy resource_document_version_read on greendogops.resource_document_version
  for select to authenticated
  using (
    greendogops.is_gdo_user()
    and exists (select 1 from greendogops.resource_document d
                 where d.id = resource_document_version.document_id)
  );

drop policy if exists resource_document_signature_read on greendogops.resource_document_signature;
create policy resource_document_signature_read on greendogops.resource_document_signature
  for select to authenticated
  using (
    greendogops.is_gdo_user()
    and (
      app_user_id = auth.uid()
      or exists (select 1 from greendogops.app_user u
                  where u.id = auth.uid() and u.is_active
                    and u.role::text in ('owner', 'admin', 'executive', 'manager'))
    )
  );

revoke insert, update, delete on greendogops.resource_document       from authenticated;
revoke insert, update, delete on greendogops.resource_document_chunk from authenticated;
revoke all on greendogops.resource_document_viewer    from anon, authenticated;
revoke all on greendogops.resource_document_version   from anon, authenticated;
revoke all on greendogops.resource_document_signature from anon, authenticated;
grant select on greendogops.resource_document_viewer    to authenticated;
grant select on greendogops.resource_document_version   to authenticated;
grant select on greendogops.resource_document_signature to authenticated;
grant select, insert, update, delete on greendogops.resource_document_viewer    to service_role;
grant select, insert, update, delete on greendogops.resource_document_version   to service_role;
grant select, insert, update, delete on greendogops.resource_document_signature to service_role;

-- ---------------------------------------------------------------------------
-- 6. Ask Ziggy passage search, filtered to what the asker may view
-- ---------------------------------------------------------------------------
drop function if exists greendogops.search_resource_content(text, integer);

create or replace function greendogops.search_resource_content(
  p_query       text,
  p_app_user_id uuid,
  p_limit       integer default 8
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
language plpgsql
stable
set search_path = greendogops, public
as $$
declare
  v_all  tsquery := websearch_to_tsquery('english', coalesce(p_query, ''));
  v_any  tsquery;
  v_role text;
begin
  select u.role::text into v_role
    from greendogops.app_user u
   where u.id = p_app_user_id and u.is_active;

  -- OR of every lexeme left after stemming and stop-word removal.
  select string_agg(quote_literal(lex), ' | ')::tsquery
    into v_any
    from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) as lex;

  if v_any is null then
    return;
  end if;

  return query
    select d.id, d.title, d.category,
           case when d.storage_path is not null or d.content_json is not null
                then '/resources/doc/' || d.id::text
                else d.source_url end,
           c.chunk_index, c.content,
           ts_rank(c.tsv, v_any) as rank
      from greendogops.resource_document_chunk c
      join greendogops.resource_document d on d.id = c.document_id
     where d.is_active
       and c.tsv @@ v_any
       and (
         d.visible_roles is null
         or v_role in ('owner', 'admin', 'executive', 'manager')
         or v_role = any (d.visible_roles)
         or exists (select 1 from greendogops.resource_document_viewer v
                     where v.document_id = d.id and v.app_user_id = p_app_user_id)
       )
     order by (v_all is not null and c.tsv @@ v_all) desc,
              ts_rank(c.tsv, v_any) desc,
              d.title, c.chunk_index
     limit greatest(1, least(coalesce(p_limit, 8), 25));
end;
$$;

revoke all on function greendogops.search_resource_content(text, uuid, integer) from public, anon, authenticated;
grant execute on function greendogops.search_resource_content(text, uuid, integer) to service_role;

commit;
