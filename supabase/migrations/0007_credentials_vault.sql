-- 0007_credentials_vault.sql
-- Credential vault for Green Dog Ops: a single, admin-only home for the many
-- vendor logins, internal accounts, phone-system extensions, EzyVet users,
-- Wi-Fi passwords, lab portals, banking & software credentials that were
-- previously scattered across spreadsheets ("Historic Passwords",
-- "MANAGERS ... Vendors_Accounts", "Vendor Contacts").
--
-- SECURITY: this table is intentionally granted to service_role ONLY (NOT to
-- anon/authenticated). The admin UI reads/writes it exclusively through the
-- service-role client (createAdminClient), and every /admin route is gated to
-- owners/admins via requireAdmin(). A regular signed-in user therefore cannot
-- read credentials even with a direct PostgREST call.
set search_path = greendogops, public;

create table if not exists greendogops.credential (
  id              uuid primary key default gen_random_uuid(),
  -- grouping bucket: vendor | lab | internal_email | phone_system | ezyvet |
  --                  wifi | banking | software | retail | technical | other
  category        text not null default 'vendor',
  label           text not null,              -- human name, e.g. "IDEXX — SO"
  service         text,                       -- system / company / portal name
  url             text,
  username        text,
  password        text,
  account_number  text,
  location        text,                        -- SO | VE | AETNA | MPMV | ALL
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  order_method    text,
  payment_method  text,
  status          text,                        -- working | not_working | unknown
  owner_scope     text,                        -- who it's for (e.g. "Managers", "Deija & CE")
  notes           text,
  -- optional link to the CRM vendor this credential belongs to
  org_id          uuid references greendogops.crm_organization (id) on delete set null,
  source          text not null default 'import',
  external_ref    text,                        -- "file:sheet:row" for idempotent re-import
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid
);

create unique index if not exists credential_external_ref_idx
  on greendogops.credential (external_ref)
  where external_ref is not null;

create index if not exists credential_category_idx on greendogops.credential (category);
create index if not exists credential_org_idx      on greendogops.credential (org_id);
create index if not exists credential_label_idx    on greendogops.credential (lower(label));

drop trigger if exists set_updated_at on greendogops.credential;
create trigger set_updated_at before update on greendogops.credential
  for each row execute function greendogops.set_updated_at();

-- service_role ONLY. Deliberately NOT granted to anon/authenticated.
revoke all on greendogops.credential from anon, authenticated;
grant select, insert, update, delete on greendogops.credential to service_role;

comment on table greendogops.credential is
  'Admin-only credential/account vault. Access via service-role client behind requireAdmin() only.';
