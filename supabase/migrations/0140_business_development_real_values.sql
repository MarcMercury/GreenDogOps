-- ============================================================================
-- Green Dog Ops — 0140 Business Development: REAL per-type base numbers
-- ----------------------------------------------------------------------------
-- 0139 seeded each appointment type's dollar value with the clinic's blended
-- average (filler). We can do better: bridge the Agenda to the invoices through
-- the CONTACT record. The Agenda stores the client as "Last, First"; the
-- contact table (ezyvet_contact) has first_name/last_name + contact_code; the
-- invoices carry client_contact_code. Matching Agenda name -> contact_code ->
-- invoice (contact_code, date, location) recovers the real revenue of each
-- appointment (~71% of Agenda appointments match a contact), so we can compute
-- the REAL average value per appointment type per clinic.
--
-- Also: the "current average appointments per day" is now a PERSISTED, EDITABLE
-- base number (column avg_per_day) seeded from the realized Agenda average,
-- instead of a read-only computed reference.
-- ============================================================================
set search_path = greendogops, public;

-- Persisted, editable "current average appointments/day" base number.
alter table greendogops.bizdev_appt_type
  add column if not exists avg_per_day numeric not null default 0;

-- ---------------------------------------------------------------------------
-- bizdev_appt_type_value() : REAL average revenue per (clinic, appointment
-- type), derived by bridging the Agenda per-appointment snapshots to the
-- invoices through the contact record.
--   * Only realized days (appt_date <= LA today) are considered.
--   * Agenda client "Last, First" (title prefix stripped) is matched to
--     ezyvet_contact by lower("last, first"); that contact_code is joined to
--     the invoice lines summed per (contact, date, location) = the appointment's
--     revenue.
--   * A name that maps to multiple contacts on the same day/clinic takes the
--     max revenue (avoids double counting).
--   * avg_value averages the matched appointments that actually generated
--     revenue (> 0); matched_paid is that sample size.
-- ---------------------------------------------------------------------------
create or replace function greendogops.bizdev_appt_type_value()
returns table (
  location_id  uuid,
  appt_type    text,
  avg_value    numeric,
  matched_paid integer
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with la_today as (
    select (now() at time zone 'America/Los_Angeles')::date as d
  ),
  ag as (
    select s.id,
           s.appt_date,
           s.location_id,
           coalesce(nullif(btrim(s.appt_type), ''), 'Unspecified') as appt_type,
           lower(btrim(regexp_replace(s.client_name, '^(mr|mrs|ms|miss|dr)\.?\s+', '', 'i'))) as name_key
    from greendogops.ezyvet_agenda_appt_snapshot s
    where s.appt_date <= (select d from la_today)
  ),
  bounds as (
    select min(appt_date) as lo, max(appt_date) as hi from ag
  ),
  c as (
    select contact_code,
           lower(btrim(last_name)) || ', ' || lower(btrim(first_name)) as name_key
    from greendogops.ezyvet_contact
    where coalesce(last_name, '') <> '' and coalesce(first_name, '') <> ''
  ),
  loc as (
    select id,
           case lower(name)
             when 'sherman oaks' then 'sherman_oaks'
             when 'van nuys'     then 'van_nuys'
             when 'venice'       then 'venice'
           end as lk
    from greendogops.location
  ),
  inv as (
    select client_contact_code, line_date, location_key,
           sum(coalesce(total_incl, 0)) as revenue
    from greendogops.ezyvet_invoice_line
    where client_contact_code is not null
      and line_date between (select lo from bounds) and (select hi from bounds)
    group by client_contact_code, line_date, location_key
  ),
  joined as (
    select ag.id, ag.location_id, ag.appt_type, max(inv.revenue) as revenue
    from ag
    join loc l on l.id = ag.location_id
    join c    on c.name_key = ag.name_key
    join inv  on inv.client_contact_code = c.contact_code
             and inv.line_date          = ag.appt_date
             and inv.location_key        = l.lk
    group by ag.id, ag.location_id, ag.appt_type
  )
  select location_id,
         appt_type,
         round(avg(revenue) filter (where revenue > 0)) as avg_value,
         count(*) filter (where revenue > 0)::int       as matched_paid
  from joined
  group by location_id, appt_type
  having count(*) filter (where revenue > 0) >= 1;
$$;

grant execute on function greendogops.bizdev_appt_type_value()
  to authenticated, service_role;

-- One-time reset: the 0139 rows carry filler (blended) values. Clear them so the
-- planner re-seeds every clinic from the REAL derived values on next load. (The
-- feature is new; no meaningful user edits to preserve.)
delete from greendogops.bizdev_appt_type;
