-- ============================================================================
-- Green Dog Ops — 0059 CRM organization agreements + document attachments
-- ----------------------------------------------------------------------------
-- Two related additions to the Vendor & Partner CRM (crm_organization), driven
-- by the Rescue Partner program but intentionally GENERIC so every vendor /
-- partner record benefits:
--   1) Agreement tracking + a second point of contact + a tax / EIN field.
--      (Rescue partners sign a partnership agreement and require two executive
--      contacts + a 501(c)(3) number; vendors have MSAs / W-9 tax IDs / an AP
--      contact — the same columns serve both.)
--   2) crm_org_document — uploadable document list per record (files stored in a
--      private Storage bucket), mirroring the employee-document model (0005).
-- ============================================================================

-- 1) New generic columns on the shared organization record -------------------
alter table greendogops.crm_organization
  add column if not exists agreement_status         text,   -- none, pending, sent, signed, expired
  add column if not exists agreement_signed_date     date,
  add column if not exists tax_id                     text,  -- 501(c)(3) # / EIN / W-9 tax id
  add column if not exists secondary_contact_name     text,
  add column if not exists secondary_contact_title    text,
  add column if not exists secondary_contact_email    text,
  add column if not exists secondary_contact_phone    text;

-- 2) Per-record document attachments ----------------------------------------
create table if not exists greendogops.crm_org_document (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references greendogops.crm_organization (id) on delete cascade,
  title         text not null,
  category      text,          -- agreement, tax_501c3, insurance, correspondence, invoice, other
  storage_path  text not null, -- object path within the crm-documents bucket
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists crm_org_document_org_idx
  on greendogops.crm_org_document (org_id, uploaded_at desc);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists set_updated_at on greendogops.crm_org_document;
create trigger set_updated_at before update on greendogops.crm_org_document
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete on greendogops.crm_org_document to authenticated, service_role;

-- Private Storage bucket for CRM record documents ---------------------------
insert into storage.buckets (id, name, public)
values ('crm-documents', 'crm-documents', false)
on conflict (id) do nothing;
