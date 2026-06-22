-- ============================================================================
-- Green Dog Ops — 0026 CE attendance backfill
-- ----------------------------------------------------------------------------
-- Seeds greendogops.crm_ce_attendance from the legacy free-text
-- crm_contact.ce_events_attended field so existing CE leads immediately have
-- itemized CE event records (and the CE Events tab is populated/searchable).
--
-- A lead may list more than one event in that single field; we split on
-- newline / semicolon / pipe so each distinct event becomes its own row.
-- Commas are intentionally NOT used as a delimiter because event names contain
-- them. Idempotent: re-running only inserts events not already present for the
-- lead, so it is safe to apply after manual edits.
-- ============================================================================
set search_path = greendogops, public;

insert into greendogops.crm_ce_attendance (contact_id, ce_name)
select c.id, trim(evt) as ce_name
from greendogops.crm_contact c
cross join lateral
  regexp_split_to_table(c.ce_events_attended, '\s*[\n;|]\s*') as evt
where c.contact_type = 'ce_attendee'
  and c.ce_events_attended is not null
  and trim(coalesce(evt, '')) <> ''
  and not exists (
    select 1
    from greendogops.crm_ce_attendance a
    where a.contact_id = c.id
      and a.ce_name = trim(evt)
  );
