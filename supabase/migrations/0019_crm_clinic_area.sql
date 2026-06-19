-- 0019_crm_clinic_area.sql
-- Adds a dedicated "clinic area" field to CRM organizations: which Green Dog Ops
-- clinic(s) a business is served by / closest to. This is distinct from `area`,
-- which records the business's own location zone (where THEY are).
-- Stored as text (comma-separated location names) to mirror the existing `area`
-- column and keep list views / search simple.

set search_path = greendogops, public;

alter table greendogops.crm_organization
  add column if not exists clinic_area text;  -- Green Dog clinic(s) served, comma-separated

comment on column greendogops.crm_organization.clinic_area is
  'Green Dog Ops clinic(s) this business is served by / closest to (comma-separated location names).';
