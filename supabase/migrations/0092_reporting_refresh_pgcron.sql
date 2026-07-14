-- ============================================================================
-- Green Dog Ops — 0092 Server-side reporting refresh via pg_cron
-- ----------------------------------------------------------------------------
-- Running refresh_ezyvet_reporting() over HTTP (PostgREST) fails: the rebuild
-- takes >150s and hits the API gateway limit, and retrying collides on the
-- matview lock ("canceling statement due to lock timeout").
--
-- Instead, run it SERVER-SIDE on a schedule with pg_cron — no HTTP gateway, no
-- lock contention. NOTE: statement_timeout must be disabled as its OWN statement
-- BEFORE the refresh call (the timer is armed at each statement's start, so a
-- function-level SET / mid-statement change is too late). The refresh takes
-- ~3 min over the full dataset. The daily agent ingest runs at 12:00 UTC (5AM
-- PDT) and finishes in a few minutes; refresh at 12:30 UTC so the roll-ups
-- always reflect the new data.
-- ============================================================================
set search_path = greendogops, public;

create extension if not exists pg_cron;

-- Idempotent (re)schedule: cron.schedule upserts by job name.
select cron.schedule(
  'ezyvet_reporting_refresh',
  '30 12 * * *',
  $$ set statement_timeout to '0'; select greendogops.refresh_ezyvet_reporting(); $$
);
