-- ============================================================================
-- Green Dog Ops — 0251 bizdev_appt_type_value(): join invoices to names first
-- ----------------------------------------------------------------------------
-- bizdev_refresh failed every run from 2026-10-13 ("canceling statement due to
-- statement timeout"): /api/agents/bizdev/refresh calls bizdev_refresh_metrics()
-- through PostgREST, where authenticator's statement_timeout is 8s, and this
-- function had grown to ~13.8s. The planner under-estimated the CTEs and joined
-- agenda rows to invoice groups on (clinic, date) first — 2.6M intermediate
-- rows, each probing ezyvet_contact by code.
--
-- Same result, different order: resolve each invoice group's client name once
-- (~6k rows), then hash-join the agenda on (name, date, clinic). Verified
-- against production 2026-10-15: identical 83 rows (EXCEPT both ways empty),
-- 13.8s -> 0.47s. CREATE OR REPLACE keeps the existing grants (service_role).
-- A function-level SET statement_timeout would not help: the timer is armed
-- when the caller's statement starts (see 0092).
-- ============================================================================

set search_path = greendogops, public;

create or replace function greendogops.bizdev_appt_type_value()
returns table (location_id uuid, appt_type text, avg_value numeric, matched_paid integer)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  with la_today as (
    select (now() at time zone 'America/Los_Angeles')::date as d
  ),
  ag as materialized (
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
  loc as (
    select id,
           case lower(name)
             when 'sherman oaks' then 'sherman_oaks'
             when 'van nuys'     then 'van_nuys'
             when 'venice'       then 'venice'
           end as lk
    from greendogops.location
  ),
  inv as materialized (
    select i.client_contact_code, i.line_date, i.location_key,
           sum(coalesce(i.total_incl, 0)) as revenue
    from greendogops.ezyvet_invoice_line i
    where i.client_contact_code is not null
      and i.line_date between (select lo from bounds) and (select hi from bounds)
    group by i.client_contact_code, i.line_date, i.location_key
  ),
  inv_named as materialized (
    select lower(btrim(c.last_name)) || ', ' || lower(btrim(c.first_name)) as name_key,
           inv.line_date, inv.location_key, inv.revenue
    from inv
    join greendogops.ezyvet_contact c on c.contact_code = inv.client_contact_code
    where coalesce(c.last_name, '') <> '' and coalesce(c.first_name, '') <> ''
  ),
  joined as (
    select ag.id, ag.location_id, ag.appt_type, max(n.revenue) as revenue
    from ag
    join loc l       on l.id = ag.location_id
    join inv_named n on n.name_key     = ag.name_key
                    and n.line_date    = ag.appt_date
                    and n.location_key = l.lk
    group by ag.id, ag.location_id, ag.appt_type
  )
  select location_id,
         appt_type,
         round(avg(revenue) filter (where revenue > 0)) as avg_value,
         count(*) filter (where revenue > 0)::int       as matched_paid
  from joined
  group by location_id, appt_type
  having count(*) filter (where revenue > 0) >= 1
;
$$;
