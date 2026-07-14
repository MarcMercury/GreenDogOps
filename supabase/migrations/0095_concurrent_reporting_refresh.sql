-- ============================================================================
-- Green Dog Ops — 0095 Non-blocking (concurrent) reporting refresh
-- ----------------------------------------------------------------------------
-- Symptom: right after an upload the Reporting → Doctors/Staff tab showed
-- "No data yet" (Doctors 0, Support Staff 0, Total Appointments 0) even though
-- the data was present, while "Provider production by location" still rendered.
--
-- Cause: refresh_ezyvet_reporting() rebuilt every report_* matview with a PLAIN
-- `refresh materialized view`, which takes an ACCESS EXCLUSIVE lock. While the
-- (multi-minute) refresh runs, the force-dynamic Reporting page's SELECTs on the
-- matviews being rebuilt BLOCK and hit the PostgREST statement timeout -> the
-- fetch returns empty -> "No data yet". Matviews refresh alphabetically, so
-- report_by_case_owner / report_by_staff (rebuilt early) were locked while
-- report_staff_by_location (later) still served old rows — exactly the observed
-- half-populated page.
--
-- Fix: refresh every matview CONCURRENTLY (readers keep seeing the old snapshot,
-- no lock wait) like ezyvet_appointment already does. CONCURRENTLY requires a
-- UNIQUE index on each matview, so add one on each matview's grain. Falls back
-- to a plain refresh per-matview if a concurrent refresh ever can't run, so a
-- refresh always completes.
-- ============================================================================
set search_path = greendogops, public;

-- Unique index per matview grain (verified duplicate-free). Enables CONCURRENTLY.
create unique index if not exists report_by_case_owner_grain_idx
  on greendogops.report_by_case_owner (year, staff_member);
create unique index if not exists report_by_staff_grain_idx
  on greendogops.report_by_staff (year, staff_member);
create unique index if not exists report_case_owner_by_month_grain_idx
  on greendogops.report_case_owner_by_month (year, case_owner, month);
create unique index if not exists report_case_owner_product_grain_idx
  on greendogops.report_case_owner_product (year, staff_member, product_name, product_group);
create unique index if not exists report_case_owner_product_group_grain_idx
  on greendogops.report_case_owner_product_group (year, staff_member, product_group);
create unique index if not exists report_dvm_by_dept_grain_idx
  on greendogops.report_dvm_by_dept (year, doctor, department_name);
create unique index if not exists report_product_by_location_grain_idx
  on greendogops.report_product_by_location (year, product_group, location_key);
create unique index if not exists report_staff_by_location_grain_idx
  on greendogops.report_staff_by_location (year, staff_member, location_key);
create unique index if not exists report_staff_product_grain_idx
  on greendogops.report_staff_product (year, staff_member, product_name, product_group);
create unique index if not exists report_staff_product_group_grain_idx
  on greendogops.report_staff_product_group (year, staff_member, product_group);
create unique index if not exists report_top_product_grain_idx
  on greendogops.report_top_product (year, product_name, product_group);
create unique index if not exists report_top_product_group_grain_idx
  on greendogops.report_top_product_group (year, product_group);

-- Rebuild the refresh so EVERY matview refreshes concurrently (no read lock),
-- with a per-matview fallback to a plain refresh if concurrent can't run (e.g.
-- the matview was never populated, so has no snapshot to diff against).
create or replace function greendogops.refresh_ezyvet_reporting()
returns void
language plpgsql
security definer
set search_path = greendogops
as $$
declare
  mv text;
begin
  -- Base appointment roll-up first (report_* views read from it).
  begin
    refresh materialized view concurrently greendogops.ezyvet_appointment;
  exception when others then
    refresh materialized view greendogops.ezyvet_appointment;
  end;

  -- Every other matview, concurrently, falling back to a plain refresh. New
  -- report matviews are picked up automatically (auto-discovery from 0054).
  for mv in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'greendogops'
      and c.relkind = 'm'
      and c.relname <> 'ezyvet_appointment'
    order by c.relname
  loop
    begin
      execute format('refresh materialized view concurrently greendogops.%I', mv);
    exception when others then
      execute format('refresh materialized view greendogops.%I', mv);
    end;
  end loop;
end;
$$;

-- Keep the unlimited statement budget for the (heavy) rebuild (migration 0091).
alter function greendogops.refresh_ezyvet_reporting() set statement_timeout = 0;

grant execute on function greendogops.refresh_ezyvet_reporting() to authenticated, service_role;
