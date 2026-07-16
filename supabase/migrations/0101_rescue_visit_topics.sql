-- ============================================================================
-- Green Dog Ops — 0101 Rescue visit topics
-- ----------------------------------------------------------------------------
-- Adds a structured "topics discussed" list to the rescue/shelter visit log,
-- mirroring clinic_visits.items_discussed in the Referral CRM. The Rescue CRM
-- Quick Visit dialog surfaces these as tappable subject chips.
-- ============================================================================

alter table greendogops.crm_org_visit
  add column if not exists topics text[];

comment on column greendogops.crm_org_visit.topics is
  'Subjects discussed during the visit (e.g. adoption_event, vaccine_clinic).';
