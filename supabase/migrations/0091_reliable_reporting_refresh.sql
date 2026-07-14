-- ============================================================================
-- Green Dog Ops — 0091 Reliable ezyVet reporting refresh
-- ----------------------------------------------------------------------------
-- The daily agent ingest of invoice lines rebuilds the materialized reporting
-- roll-ups via refresh_ezyvet_reporting(). On the full dataset that refresh can
-- exceed the caller's statement_timeout ("canceling statement due to statement
-- timeout"), leaving the aggregated Reporting page a day stale.
--
-- Disable the statement timeout FOR THIS FUNCTION ONLY so the (heavy, but
-- infrequent) refresh always runs to completion. Row-level ingest is unaffected;
-- only the roll-up rebuild gets the unlimited budget. The agent invokes it from
-- a dedicated, isolated step (/api/agents/ezyvet/refresh) after the uploads.
-- ============================================================================
set search_path = greendogops, public;

alter function greendogops.refresh_ezyvet_reporting() set statement_timeout = 0;
