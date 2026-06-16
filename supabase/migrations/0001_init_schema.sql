-- ============================================================================
-- Green Dog Ops — 0001 init: isolated schema
-- ----------------------------------------------------------------------------
-- Green Dog Ops SHARES a Supabase project with EmployeeGMGDD but is fully
-- isolated in its OWN Postgres schema. EmployeeGMGDD owns `public`; we never
-- create or modify objects there. All Green Dog Ops tables live in `greendogops`.
--
-- After running this, in the Supabase Dashboard:
--   Settings -> API -> "Exposed schemas": add `greendogops`
-- so PostgREST/supabase-js can reach it (the client is configured with
-- db.schema = 'greendogops').
-- ============================================================================

create schema if not exists greendogops;

-- Let the API roles use the schema. Table-level access is locked down per-table
-- via RLS in later migrations; this only grants the ability to "see" the schema.
grant usage on schema greendogops to anon, authenticated, service_role;

-- Default privileges so future tables are reachable by the API roles
-- (still governed by RLS policies defined per table).
alter default privileges in schema greendogops
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema greendogops
  grant usage, select on sequences to authenticated, service_role;

comment on schema greendogops is
  'Isolated schema for the Green Dog Ops app. Shares the Supabase project with EmployeeGMGDD (public) but must never collide with it.';
