-- 0046_resource_categories.sql
-- Make the Resources library's document categories dynamic so admins can add
-- their own, and let a resource_document be an external LINK (source_url) with
-- no uploaded file (storage_path). Seeds the previously-hardcoded categories
-- plus new CVMA (California VMA) and AVMA (American VMA) categories.

-- 1) Dynamic category catalog -------------------------------------------------
create table if not exists greendogops.resource_category (
  key         text primary key,
  label       text not null,
  icon        text not null default '📄',
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_by  uuid,                 -- auth.users.id, best-effort
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on greendogops.resource_category;
create trigger set_updated_at before update on greendogops.resource_category
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.resource_category to authenticated, service_role;

-- Seed the categories that used to live in RESOURCE_CATEGORY_META, plus the two
-- new association categories. Idempotent: keeps any label/icon already present.
insert into greendogops.resource_category (key, label, icon, sort_order) values
  ('hr',         'HR',                    '👥', 10),
  ('safety',     'Safety',                '🦺', 20),
  ('operations', 'Operations',            '⚙️', 30),
  ('marketing',  'Marketing & Events',    '📣', 40),
  ('medical',    'Medical & Compliance',  '🩺', 50),
  ('recruiting', 'Recruiting',            '🎯', 60),
  ('training',   'Training',              '🎓', 70),
  ('forms',      'Forms',                 '📝', 80),
  ('cvma',       'CVMA (California VMA)',  '🐾', 90),
  ('avma',       'AVMA (American VMA)',    '🏛️', 95),
  ('general',    'General',               '📄', 100)
on conflict (key) do nothing;

-- Backfill any category strings already used by documents that we did not seed
-- above, so the catalog is complete and nothing loses its grouping.
insert into greendogops.resource_category (key, label, icon, sort_order)
select distinct d.category,
       initcap(replace(d.category, '_', ' ')),
       '📄',
       100
from greendogops.resource_document d
where d.category is not null
  and not exists (
    select 1 from greendogops.resource_category c where c.key = d.category
  );

-- 2) Allow link-only resources (external URL, no uploaded file) ----------------
alter table greendogops.resource_document
  alter column storage_path drop not null;

alter table greendogops.resource_document
  drop constraint if exists resource_document_has_target;
alter table greendogops.resource_document
  add constraint resource_document_has_target
  check (storage_path is not null or source_url is not null);
