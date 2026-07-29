-- ============================================================================
-- Green Dog Ops — 0149 Time-off request provenance (When I Work sync)
-- ----------------------------------------------------------------------------
-- Adds source-tracking to greendogops.person_time_off so PTO requests pulled
-- automatically from the When I Work API can be upserted idempotently without
-- clobbering rows entered by hand on the HR profile.
--
--   * source       — where the row originated ('manual' | 'wheniwork').
--   * external_id  — the originating system's stable request id (When I Work
--                    request id). NULL for hand-entered rows.
--
-- A unique index on (source, external_id) is the ON CONFLICT target for the
-- poller's upsert. Manual rows keep external_id NULL, and Postgres treats NULLs
-- as distinct, so hand-entered requests never collide with each other.
-- ============================================================================
set search_path = greendogops, public;

alter table greendogops.person_time_off
  add column if not exists source text not null default 'manual';
alter table greendogops.person_time_off
  add column if not exists external_id text;

comment on column greendogops.person_time_off.source is
  'Origin of the request: manual (HR profile) or wheniwork (API sync).';
comment on column greendogops.person_time_off.external_id is
  'Stable id from the source system (e.g. When I Work request id); NULL when manual.';

create unique index if not exists person_time_off_source_external_uk
  on greendogops.person_time_off (source, external_id);
