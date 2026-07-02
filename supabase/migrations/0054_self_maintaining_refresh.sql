-- ============================================================================
-- Green Dog Ops — 0054 Self-maintaining reporting refresh
-- ----------------------------------------------------------------------------
-- Every invoice upload/delete/reset calls refresh_ezyvet_reporting(). Instead
-- of hand-listing each materialized view (easy to forget when we add reports),
-- this rebuilds it to auto-discover and refresh EVERY materialized view in the
-- greendogops schema. New report matviews are then always refreshed on upload —
-- so all reporting sections and tabs reflect newly imported data automatically.
--
-- ezyvet_appointment refreshes first and CONCURRENTLY (it has a unique index,
-- so readers aren't blocked); if that's not possible it falls back to a plain
-- refresh. The appointment-derived report_* objects are PLAIN views over it, so
-- they update for free. All other matviews read ezyvet_invoice_line directly.
-- ============================================================================
set search_path = greendogops, public;

create or replace function greendogops.refresh_ezyvet_reporting()
returns void
language plpgsql
security definer
set search_path = greendogops
as $$
declare
  mv text;
begin
  -- Base appointment roll-up first (concurrent = no read lock; fall back if the
  -- matview was never populated or lacks its unique index for any reason).
  begin
    refresh materialized view concurrently greendogops.ezyvet_appointment;
  exception when others then
    refresh materialized view greendogops.ezyvet_appointment;
  end;

  -- Refresh every other materialized view in the schema. Adding a new report
  -- matview requires no change here — it is picked up automatically.
  for mv in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'greendogops'
      and c.relkind = 'm'
      and c.relname <> 'ezyvet_appointment'
    order by c.relname
  loop
    execute format('refresh materialized view greendogops.%I', mv);
  end loop;
end;
$$;

grant execute on function greendogops.refresh_ezyvet_reporting() to authenticated, service_role;
