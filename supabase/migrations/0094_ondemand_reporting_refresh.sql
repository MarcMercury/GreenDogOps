-- ============================================================================
-- Green Dog Ops — 0094 On-demand reporting refresh (no HTTP gateway timeout)
-- ----------------------------------------------------------------------------
-- A manual invoice upload used to finish by calling refresh_ezyvet_reporting()
-- SYNCHRONOUSLY over HTTP (PostgREST rpc) from finalizeInvoiceImport. That
-- rebuild takes ~3 min on the full dataset, but the Supabase API gateway cuts
-- any request off at ~150s -> the user sees "upstream request timeout" even
-- though the lines were imported fine (same failure 0092 documented for the
-- daily job).
--
-- Fix: never rebuild the roll-ups inside the HTTP request. The uploader now just
-- REQUESTS a refresh (a trivial UPDATE that returns instantly); a server-side
-- pg_cron worker running every minute performs the heavy rebuild with no gateway
-- in the path. An advisory lock guarantees only ONE refresh runs at a time, so a
-- manual request can never collide with the daily job (which 0092 warned about:
-- "canceling statement due to lock timeout"). The daily job is re-pointed to go
-- through the same request/worker path so every refresh is serialized.
--
-- NOTE (see 0091/0092): statement_timeout must be disabled as its OWN statement
-- BEFORE the refresh call in the cron command (the timer is armed at each
-- statement's start), which is why the worker cron body sets it first.
-- ============================================================================
set search_path = greendogops, public;

create extension if not exists pg_cron;

-- Single-row state: when a refresh was last requested vs. last completed.
create table if not exists greendogops.reporting_refresh_state (
  id boolean primary key default true check (id),
  requested_at timestamptz,
  completed_at timestamptz
);
insert into greendogops.reporting_refresh_state (id)
values (true)
on conflict (id) do nothing;

-- Called by the app (finalizeInvoiceImport/delete/reset). Returns immediately;
-- the worker below does the actual rebuild within the next minute.
create or replace function greendogops.request_reporting_refresh()
returns void
language sql
security definer
set search_path = greendogops, public
as $$
  update greendogops.reporting_refresh_state set requested_at = now() where id;
$$;

-- Server-side worker: rebuild the roll-ups iff a refresh is pending and no other
-- refresh is already running (advisory lock). No-op otherwise, so running every
-- minute is cheap.
create or replace function greendogops.process_reporting_refresh()
returns void
language plpgsql
security definer
set search_path = greendogops, public
as $$
declare
  pending boolean;
begin
  -- Only one refresh at a time (manual request vs. daily job).
  if not pg_try_advisory_xact_lock(hashtext('greendogops.reporting_refresh')) then
    return;
  end if;

  select requested_at is not null
         and (completed_at is null or requested_at > completed_at)
    into pending
  from greendogops.reporting_refresh_state
  where id;

  if not pending then
    return;
  end if;

  perform greendogops.refresh_ezyvet_reporting();
  update greendogops.reporting_refresh_state set completed_at = now() where id;
end;
$$;

grant execute on function greendogops.request_reporting_refresh() to authenticated, service_role;
grant execute on function greendogops.process_reporting_refresh() to authenticated, service_role;

-- Worker: runs every minute, disabling statement_timeout as its own statement
-- first so the heavy rebuild is never cut off (0091/0092).
select cron.schedule(
  'ezyvet_reporting_refresh_worker',
  '* * * * *',
  $$ set statement_timeout to '0'; select greendogops.process_reporting_refresh(); $$
);

-- Re-point the daily job (0092) through the same serialized request/worker path
-- so the daily and manual refreshes can never overlap. cron.schedule upserts by
-- name, overwriting the previous direct-refresh command.
select cron.schedule(
  'ezyvet_reporting_refresh',
  '30 12 * * *',
  $$ select greendogops.request_reporting_refresh(); $$
);
