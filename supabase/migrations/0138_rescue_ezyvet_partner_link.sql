-- ---------------------------------------------------------------------------
-- 0138  Rescue/Shelter ⇄ ezyVet "rescue partner" contact link
-- ---------------------------------------------------------------------------
-- The ezyVet Contacts export (ingested daily by the agent into
-- greendogops.ezyvet_contact) tags some contacts with Customer Group
-- "Rescue Partners". A daily reconciliation assimilates those contacts into the
-- Rescue/Shelter CRM (crm_organization, subtype='rescue'): matched records get
-- their blank fields filled from ezyVet, and unmatched partners get a new rescue
-- record created.
--
-- This column stores the source ezyVet Contact Id on the rescue record so the
-- sync is idempotent (re-links to the same record instead of duplicating) and
-- provenance is visible.
-- ---------------------------------------------------------------------------

alter table greendogops.crm_organization
  add column if not exists ezyvet_contact_id text;

create index if not exists idx_crm_org_ezyvet_contact
  on greendogops.crm_organization (ezyvet_contact_id)
  where ezyvet_contact_id is not null;
