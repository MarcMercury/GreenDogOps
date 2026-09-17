-- ============================================================================
-- Green Dog Ops — 0192 Per-location appointments/revenue for an arbitrary range
-- ----------------------------------------------------------------------------
-- The report_* views only expose a YEAR (report_by_location) or MONTH
-- (report_location_monthly) grain, so month-to-date "through the same day of
-- the month" comparisons were impossible without pulling every appointment row
-- into the app. The ezyvet_appointment matview already has the day grain (one
-- row per client + service_date + clinic), so this wraps it in a range query.
--
-- Used by the weekly Ops Reporting Slack digest (src/lib/reporting/digest.ts).
-- security definer because 0164 revoked the matview from `authenticated`.
-- ============================================================================
set search_path = greendogops, public;

drop function if exists greendogops.report_location_period(date, date);
create or replace function greendogops.report_location_period(p_start date, p_end date)
returns table (
  location_key   text,
  location_label text,
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
    count(*)::int                                as appointments,
    coalesce(sum(a.revenue), 0)                  as revenue,
    count(distinct a.client_contact_code)::int   as unique_clients
  from greendogops.ezyvet_appointment a
  where a.service_date between p_start and p_end
  group by a.location_key
  order by appointments desc;
$$;

grant execute on function greendogops.report_location_period(date, date)
  to authenticated, service_role;

comment on function greendogops.report_location_period(date, date) is
  'Appointments, revenue and unique clients per clinic for an arbitrary date range (inclusive), from the ezyvet_appointment day-grain matview. Use for month-to-date / same-day-last-month comparisons; report_by_location and report_location_monthly only offer year and month grains.';
