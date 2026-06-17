-- 0011_opportunity_type.sql
-- Shared "Opportunity Type" describing the NATURE of a person's engagement with
-- Green Dog (externship, internship, shadowing, volunteer, cohort, Vet America
-- mentee, W2 hire, 1099 contractor, etc). Source: "GDD Opportunity Types" doc.
--
-- It lives on the shared greendogops.person row so it travels automatically
-- across ATS applicant -> Employee, and on greendogops.crm_contact for the
-- Student CRM (carried onto the person record at promotion time).
--
-- Stored as free text; the canonical value list + labels live in
-- src/lib/shared/opportunity-types.ts (matches the app's stage/text-list pattern).

alter table greendogops.person
  add column if not exists opportunity_type text;

alter table greendogops.crm_contact
  add column if not exists opportunity_type text;

comment on column greendogops.person.opportunity_type is
  'Nature of engagement (see OPPORTUNITY_TYPES in src/lib/shared/opportunity-types.ts)';
comment on column greendogops.crm_contact.opportunity_type is
  'Nature of engagement (see OPPORTUNITY_TYPES in src/lib/shared/opportunity-types.ts)';
