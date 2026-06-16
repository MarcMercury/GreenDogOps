-- 0005_admin_module.sql
-- Admin, user management & permissions for Green Dog Ops.
-- auth.users is SHARED with EmployeeGMGDD (project-level). app_user is the
-- allow-list + role/permission layer that gates access to Green Dog Ops:
-- a row here (is_active = true) is required to use GDO at all.
set search_path = greendogops, public;

-- Roles, from most to least privileged.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'app_role' and n.nspname = 'greendogops') then
    create type greendogops.app_role as enum
      ('owner', 'admin', 'manager', 'staff', 'viewer');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- app_user : GDO access allow-list. id mirrors auth.users.id.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.app_user (
  id             uuid primary key,           -- = auth.users.id
  email          text not null,
  full_name      text,
  title          text,
  role           greendogops.app_role not null default 'staff',
  is_active      boolean not null default true,
  -- per-user module overrides: { "hr": true, "admin": false }. Empty => role defaults.
  module_access  jsonb not null default '{}'::jsonb,
  notes          text,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid
);

create unique index if not exists app_user_email_idx
  on greendogops.app_user (lower(email));
create index if not exists app_user_role_idx on greendogops.app_user (role);

drop trigger if exists set_updated_at on greendogops.app_user;
create trigger set_updated_at before update on greendogops.app_user
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- app_setting : global program controls (key/value).
-- ---------------------------------------------------------------------------
create table if not exists greendogops.app_setting (
  key          text primary key,
  value        jsonb not null default 'null'::jsonb,
  category     text not null default 'general',
  label        text,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

drop trigger if exists set_updated_at on greendogops.app_setting;
create trigger set_updated_at before update on greendogops.app_setting
  for each row execute function greendogops.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_log : who did what, for accountability.
-- ---------------------------------------------------------------------------
create table if not exists greendogops.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,
  actor_email  text,
  action       text not null,                -- e.g. 'user.role_changed'
  entity       text,                         -- e.g. 'app_user'
  entity_id    text,
  summary      text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_idx
  on greendogops.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on greendogops.audit_log (actor_id);

-- ---------------------------------------------------------------------------
-- Helper: is the given auth user an active GDO admin/owner?
-- ---------------------------------------------------------------------------
create or replace function greendogops.is_gdo_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = greendogops
as $$
  select exists (
    select 1 from greendogops.app_user
    where id = uid and is_active and role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Seed: founder/owner + sensible default settings.
-- ---------------------------------------------------------------------------
insert into greendogops.app_user (id, email, full_name, title, role, is_active)
values (
  '8e8a9b22-a116-4811-b799-68daebad92c9',
  'marcm@greendogdental.com',
  'Marc Mercury',
  'Founder',
  'owner',
  true
)
on conflict (id) do update
  set role = 'owner', is_active = true, full_name = excluded.full_name;

insert into greendogops.app_setting (key, value, category, label, description) values
  ('org.name',            '"Green Dog Veterinary Center"', 'general',  'Organization name', 'Display name for the practice.'),
  ('org.timezone',        '"America/Los_Angeles"',         'general',  'Time zone',         'Default time zone for dates & scheduling.'),
  ('org.locations',       '["San Marino","Venice","Aetna"]','general', 'Locations',         'Active practice locations.'),
  ('security.session_timeout_minutes', '720',              'security', 'Session timeout',   'Minutes before an idle session expires.'),
  ('security.require_admin_invite',    'true',              'security', 'Invite-only access','Only invited users may access GDO.'),
  ('features.ai_assist',  'true',                           'features', 'AI assist',         'Enable AI auto-fill & suggestions.'),
  ('features.audit_log',  'true',                           'features', 'Audit logging',     'Record user actions to the audit log.')
on conflict (key) do nothing;

grant select, insert, update, delete on greendogops.app_user    to authenticated, service_role;
grant select, insert, update, delete on greendogops.app_setting to authenticated, service_role;
grant select, insert, update, delete on greendogops.audit_log   to authenticated, service_role;
