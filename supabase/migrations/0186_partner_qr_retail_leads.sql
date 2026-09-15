-- ============================================================================
-- Green Dog Ops — 0186 Non-Med Partner QR codes + Retail Leads
-- ----------------------------------------------------------------------------
-- Every partner record gets a stable `qr_token`. The token is the only thing
-- encoded in the printed QR code, so it must never be the row id (which leaks
-- an internal key and lets anyone enumerate the CRM) and must be assigned
-- automatically for new records — hence a column DEFAULT rather than app code.
--
-- Scanning a partner's code opens the public /lead/<token> form, whose
-- submissions land in crm_retail_lead. That table is the "Retail Leads" tab and
-- the QR section of the Non-Med Partners Reports tab.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1) Partner QR token
-- ---------------------------------------------------------------------------
-- pgcrypto lives in the `extensions` schema on Supabase, so gen_random_bytes
-- must be schema-qualified — a pinned search_path will not find it.
create or replace function greendogops.new_qr_token()
returns text
language sql
volatile
set search_path = greendogops, extensions, pg_catalog, public
as $$ select encode(extensions.gen_random_bytes(8), 'hex') $$;

comment on function greendogops.new_qr_token() is
  'Random 16-char hex token used as the public, non-enumerable handle in a partner QR code URL.';

alter table greendogops.crm_organization
  add column if not exists qr_token text;

-- Backfill without touching updated_at — this is a system stamp, not an edit,
-- and every partner would otherwise look like it was just modified.
alter table greendogops.crm_organization disable trigger set_updated_at;
update greendogops.crm_organization
   set qr_token = greendogops.new_qr_token()
 where qr_token is null;
alter table greendogops.crm_organization enable trigger set_updated_at;

alter table greendogops.crm_organization
  alter column qr_token set default greendogops.new_qr_token();
alter table greendogops.crm_organization
  alter column qr_token set not null;

create unique index if not exists crm_organization_qr_token_key
  on greendogops.crm_organization (qr_token);

comment on column greendogops.crm_organization.qr_token is
  'Public handle encoded in this record''s QR code (/lead/<qr_token>). Auto-assigned on insert.';

-- ---------------------------------------------------------------------------
-- 2) Retail leads captured by scanning a partner's QR code
-- ---------------------------------------------------------------------------
create table if not exists greendogops.crm_retail_lead (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references greendogops.crm_organization (id) on delete cascade,
  full_name   text not null,
  email       text,
  phone       text,
  pet_name    text,
  -- When the QR code was scanned / the form submitted.
  scanned_at  timestamptz not null default now(),
  status      text not null default 'new',
  notes       text,
  source      text not null default 'qr_scan',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists crm_retail_lead_org_idx
  on greendogops.crm_retail_lead (org_id, scanned_at desc);
create index if not exists crm_retail_lead_scanned_idx
  on greendogops.crm_retail_lead (scanned_at desc);
create index if not exists crm_retail_lead_status_idx
  on greendogops.crm_retail_lead (status);

drop trigger if exists set_updated_at on greendogops.crm_retail_lead;
create trigger set_updated_at before update on greendogops.crm_retail_lead
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.crm_retail_lead to authenticated, service_role;

comment on table greendogops.crm_retail_lead is
  'Consumer leads captured from a Non-Med Partner QR code scan (public /lead/<token> form).';
