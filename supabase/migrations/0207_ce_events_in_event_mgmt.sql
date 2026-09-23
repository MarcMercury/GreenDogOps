-- ============================================================================
-- Green Dog Ops — 0207 CE courses roll up into Event Management
-- ----------------------------------------------------------------------------
-- WHY: a CE course IS a company event — it takes a date, a room, staff and
-- attendees — but it is BUILT in the CE module (RACE approval, CE Broker
-- submission, credit hours). Duplicating it into marketing_event would give us
-- two records that drift.
--
-- So the rollup is a READ-TIME projection: /marketing/events selects
-- crm_ce_event alongside marketing_event and renders both. Nothing is copied.
-- The only thing CE courses were missing is the one capability that lives on
-- the events side — a QR code and its capture form — so qr_code / qr_lead
-- gain a ce_event_id, exactly mirroring their existing event_id.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.qr_code
  add column if not exists ce_event_id uuid
    references greendogops.crm_ce_event (id) on delete cascade;

create index if not exists qr_code_ce_event_idx
  on greendogops.qr_code (ce_event_id);

comment on column greendogops.qr_code.ce_event_id is
  'CE course this code belongs to (crm_ce_event). Mutually exclusive with event_id in practice; code_type = ''ce''.';

alter table greendogops.qr_lead
  add column if not exists ce_event_id uuid
    references greendogops.crm_ce_event (id) on delete set null;

create index if not exists qr_lead_ce_event_idx
  on greendogops.qr_lead (ce_event_id, scanned_at desc);

comment on column greendogops.qr_lead.ce_event_id is
  'Denormalized from the scanned code so the Event Leads tab can filter CE courses without a join.';
