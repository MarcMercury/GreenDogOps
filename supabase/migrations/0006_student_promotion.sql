-- ============================================================================
-- Green Dog Ops — 0006 Student → Recruiting → Employee lineage
-- ----------------------------------------------------------------------------
-- The Student CRM (greendogops.crm_contact, contact_type='student') stays
-- SEPARATE from the ATS. A student can be PROMOTED into the Recruiting CRM,
-- which creates a unified greendogops.person (status='applicant') + a
-- person_recruiting row. From there the existing ATS "hire" flow advances the
-- same person to status='employee'. These columns preserve the lineage in both
-- directions so the record details are carried forward, never lost.
-- ============================================================================

set search_path = greendogops, public;

-- Forward link: which person a student was promoted into (null = not promoted).
alter table greendogops.crm_contact
  add column if not exists promoted_person_id uuid
    references greendogops.person (id) on delete set null,
  add column if not exists promoted_at timestamptz;

create index if not exists crm_contact_promoted_person_idx
  on greendogops.crm_contact (promoted_person_id)
  where promoted_person_id is not null;

-- Back link: which CRM contact a person originated from (e.g. a student).
alter table greendogops.person
  add column if not exists source_contact_id uuid
    references greendogops.crm_contact (id) on delete set null;

create index if not exists person_source_contact_idx
  on greendogops.person (source_contact_id)
  where source_contact_id is not null;
