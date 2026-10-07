-- ============================================================================
-- Green Dog Ops — 0222 Per-location, per-DAY appointments/revenue for a range
-- ----------------------------------------------------------------------------
-- 0192's report_location_period() collapses a date range to one row per clinic,
-- which hides how many days actually contributed to the total. The weekly Slack
-- digest needs that detail for three reasons:
--
--   1. The clinics are closed Sundays, Sherman Oaks only runs Mon/Wed/Fri, and
--      holidays close everyone. Comparing raw range totals silently compares
--      different numbers of trading days.
--   2. A day the ezyVet invoice-line ingest never loaded looks exactly like a
--      day with no business. At the day grain the digest can spot the hole
--      (a scheduled open day with zero rows) and leave it out of the average
--      instead of reporting a fake collapse in volume.
--   3. Per-open-day averages are the only fair way to compare a short window
--      against a full one.
--
-- Same source and security posture as 0192: the day-grain ezyvet_appointment
-- matview, security definer because 0164 revoked the matview from
-- `authenticated`. Callers MUST do their own authorization.
-- ============================================================================
set search_path = greendogops, public;

drop function if exists greendogops.report_location_daily(date, date);
create or replace function greendogops.report_location_daily(p_start date, p_end date)
returns table (
  location_key   text,
  location_label text,
  service_date   date,
  appointments   integer,
  revenue        numeric,
  unique_clients integer
)
language sql
stable
security definer
set search_path = greendogops, public
as $$
  select
    a.location_key,
    max(a.location_label)                        as location_label,
    a.service_date,
    count(*)::int                                as appointments,
    coalesce(sum(a.revenue), 0)                  as revenue,
    count(distinct a.client_contact_code)::int   as unique_clients
  from greendogops.ezyvet_appointment a
  where a.service_date between p_start and p_end
  group by a.location_key, a.service_date
  order by a.service_date, a.location_key;
$$;

-- 0211 revoked EXECUTE from PUBLIC/anon on every greendogops routine; grant the
-- same two roles 0192 gives report_location_period and nothing more.
revoke all on function greendogops.report_location_daily(date, date) from public;
grant execute on function greendogops.report_location_daily(date, date)
  to authenticated, service_role;

comment on function greendogops.report_location_daily(date, date) is
  'Appointments, revenue and unique clients per clinic PER DAY for an arbitrary date range (inclusive), from the ezyvet_appointment day-grain matview. Rows exist only for days a clinic actually billed, so the caller can count real trading days, detect missing ingest days, and normalize totals per open day. Use report_location_period() when a single collapsed total per clinic is enough.';
