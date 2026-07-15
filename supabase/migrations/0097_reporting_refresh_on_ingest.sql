-- ============================================================================
-- Green Dog Ops — 0097 Auto-request reporting refresh on ingest
-- ----------------------------------------------------------------------------
-- The daily reporting refresh (0092/0094) fires at a FIXED time (12:30 UTC) and
-- only rolls up whatever invoice data has landed by then. When the agent runs a
-- backfill or finishes late, invoice lines keep arriving AFTER 12:30, so those
-- rows never make it into the report_* matviews until the next day's run — the
-- Reporting page shows stale numbers. (Observed 2026-07-15: the refresh ran at
-- 12:31 UTC but five more scheduled runs kept uploading invoice lines until
-- 12:57 UTC, none of which were rolled up.)
--
-- Fix: make the refresh EVENT-DRIVEN at the database level. A statement-level
-- trigger on ezyvet_invoice_line (the single source table behind every report
-- matview -> ezyvet_appointment -> report_*) calls request_reporting_refresh()
-- whenever invoice data changes. That is a trivial single-row UPDATE (returns
-- instantly); the existing server-side worker (ezyvet_reporting_refresh_worker,
-- every minute, migration 0094) performs the heavy rebuild under an advisory
-- lock so refreshes never overlap. Net effect: the Reporting page catches up
-- within ~1 minute of the last invoice rows landing, no matter when or how
-- often the agent runs — and with no application-code deploy required.
-- ============================================================================
set search_path = greendogops, public;

create or replace function greendogops.trg_request_reporting_refresh()
returns trigger
language plpgsql
security definer
set search_path = greendogops, public
as $$
begin
  perform greendogops.request_reporting_refresh();
  return null;  -- AFTER STATEMENT trigger: the return value is ignored.
end;
$$;

drop trigger if exists request_reporting_refresh_on_invoice_line
  on greendogops.ezyvet_invoice_line;

create trigger request_reporting_refresh_on_invoice_line
  after insert or update or delete
  on greendogops.ezyvet_invoice_line
  for each statement
  execute function greendogops.trg_request_reporting_refresh();
