-- ============================================================================
-- Green Dog Ops — 0079 Profile documents + transition log
-- ----------------------------------------------------------------------------
-- Makes documents and stage history follow a person through the full talent
-- pipeline:  Student CRM  ->  ATS (applicant)  ->  HR / Roster (employee).
--
-- Key facts about the data model this builds on:
--   * An ATS candidate and an HR employee are the SAME greendogops.person row
--     (only person.status flips applicant -> employee), so any row in
--     greendogops.person_document (bucket employee-documents) is ALREADY shared
--     between the ATS and HR views automatically.
--   * A student is a SEPARATE greendogops.crm_contact row, so its attachments
--     have had nowhere to live and could not travel on promotion. This migration
--     adds a per-contact document table and copies those files onto the new
--     person's person_document rows when a student is promoted.
--
-- Additions:
--   1) crm_contact_document — uploadable attachments per CRM contact (students),
--      files stored in the existing private crm-documents bucket.
--   2) person_document.source — free-text note (e.g. "Migrated from Student CRM")
--      so a document's origin travels with it.
--   3) profile_transition_log — an append-only audit of every stage move a
--      profile makes (promoted to ATS, hired to roster, direct entry, docs
--      migrated), surfaced read-only on the ATS + HR "History" tabs.
-- ============================================================================

-- 1) Per-contact document attachments (mirrors crm_org_document from 0059) ----
create table if not exists greendogops.crm_contact_document (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references greendogops.crm_contact (id) on delete cascade,
  title         text not null,
  category      text,          -- resume, transcript, application, id, license, certification, other
  storage_path  text not null, -- object path within the crm-documents bucket
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists crm_contact_document_contact_idx
  on greendogops.crm_contact_document (contact_id, uploaded_at desc);

drop trigger if exists set_updated_at on greendogops.crm_contact_document;
create trigger set_updated_at before update on greendogops.crm_contact_document
  for each row execute function greendogops.set_updated_at();

grant select, insert, update, delete
  on greendogops.crm_contact_document to authenticated, service_role;

-- Reuse the existing private crm-documents bucket (created in 0059). Ensure it
-- exists in case 0059 has not been applied in this environment.
insert into storage.buckets (id, name, public)
values ('crm-documents', 'crm-documents', false)
on conflict (id) do nothing;

-- 2) Tag a document with where it came from so its origin travels with it -----
alter table greendogops.person_document
  add column if not exists source text;

-- 3) Append-only profile transition / movement log ---------------------------
create table if not exists greendogops.profile_transition_log (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid references greendogops.person (id) on delete cascade,
  contact_id   uuid references greendogops.crm_contact (id) on delete set null,
  event_type   text not null,   -- promoted_to_ats, hired_to_roster, direct_entry,
                                 -- documents_migrated, status_change
  from_stage   text,            -- student, prospect, applicant, employee, contractor, former
  to_stage     text,
  detail       text,            -- human-readable note (e.g. "3 documents copied")
  actor_id     uuid,            -- app_user / auth.users id who triggered the move
  actor_name   text,
  created_at   timestamptz not null default now()
);
create index if not exists profile_transition_log_person_idx
  on greendogops.profile_transition_log (person_id, created_at desc);
create index if not exists profile_transition_log_contact_idx
  on greendogops.profile_transition_log (contact_id, created_at desc);

grant select, insert
  on greendogops.profile_transition_log to authenticated, service_role;
