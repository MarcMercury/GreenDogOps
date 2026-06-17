-- 0011_resources_library.sql
-- Resources library: company policy documents (PDFs) stored in a private
-- Storage bucket, with metadata in greendogops.resource_document.
-- Files are auth-gated and served via short-lived signed URLs (never public).

create table if not exists greendogops.resource_document (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  category      text not null default 'general', -- hr, safety, operations, marketing, medical, recruiting, training, forms, general
  description   text,
  storage_path  text not null,        -- object path within the 'resources' bucket
  file_name     text,
  mime_type     text default 'application/pdf',
  size_bytes    bigint,
  source_url    text,                 -- optional external/original link
  staff_only    boolean not null default false,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  uploaded_by   uuid,                 -- auth.users.id, best-effort
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists resource_document_category_idx
  on greendogops.resource_document (category, sort_order, title);

-- updated_at trigger
drop trigger if exists set_updated_at on greendogops.resource_document;
create trigger set_updated_at before update on greendogops.resource_document
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.resource_document to authenticated, service_role;

-- Private Storage bucket for resource documents (not public).
insert into storage.buckets (id, name, public)
values ('resources', 'resources', false)
on conflict (id) do nothing;
