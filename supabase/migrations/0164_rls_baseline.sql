-- ============================================================================
-- 0164 — Row Level Security baseline
--
-- WHY: 0001_init_schema.sql granted select/insert/update/delete on every
-- greendogops table to `authenticated` on the stated assumption that
-- "table-level access is locked down per-table via RLS in later migrations".
-- That RLS was never written, so RLS was off on all 94 base tables.
--
-- The Supabase project is SHARED with EmployeeGMGDD: auth.users holds 102
-- accounts while greendogops.app_user only allow-lists 25. Every one of the
-- other 77 accounts still received the `authenticated` role in its JWT and
-- could therefore read AND write every Green Dog Ops table (compensation,
-- disciplinary records, client/patient data) straight through PostgREST with
-- the public anon key. Any of them could also PATCH their own app_user row to
-- role='owner'.
--
-- This migration closes that by:
--   1. Enabling RLS on every base table with a membership policy that mirrors
--      the app's existing behaviour (active app_user => same access as today).
--   2. Making app_user read-own-row only; all writes already go through the
--      service-role client in admin/actions.ts and user-roster-sync.ts.
--   3. Revoking anon and authenticated from views/matviews, which cannot honour
--      RLS. Reporting and ezyVet pages read them via the service-role client
--      behind their own module gates.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Membership predicate
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the lookup itself is not subject to app_user's own RLS.
create or replace function greendogops.is_gdo_user()
returns boolean
language sql
stable
security definer
set search_path = greendogops, pg_catalog
as $$
  select exists (
    select 1
    from greendogops.app_user
    where id = auth.uid()
      and is_active
  );
$$;

comment on function greendogops.is_gdo_user() is
  'True when the current JWT belongs to an active greendogops.app_user. auth.users is shared with EmployeeGMGDD, so a session alone is NOT sufficient.';

revoke all on function greendogops.is_gdo_user() from public;
grant execute on function greendogops.is_gdo_user() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. anon never needs table access (public CE sign-up uses the service role)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema greendogops from anon;
revoke all on all sequences in schema greendogops from anon;
alter default privileges in schema greendogops revoke all on tables from anon;
alter default privileges in schema greendogops revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- 3. Enable RLS + membership policy on every base table
-- ---------------------------------------------------------------------------
-- The policy is deliberately as permissive as today's behaviour for GDO users,
-- so nothing in the app changes. It exists to shut out the 77 non-GDO accounts.
-- Per-module and per-field authorization stays in src/lib/auth (ensureCanEdit,
-- canAccessModule); tightening individual tables is a follow-up.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'greendogops'
      and c.relkind = 'r'
  loop
    execute format('alter table greendogops.%I enable row level security', t.relname);
    execute format('drop policy if exists gdo_members_all on greendogops.%I', t.relname);
    execute format(
      'create policy gdo_members_all on greendogops.%I '
      'for all to authenticated '
      'using (greendogops.is_gdo_user()) '
      'with check (greendogops.is_gdo_user())',
      t.relname
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. app_user: read own row only — no self-service role escalation
-- ---------------------------------------------------------------------------
-- getCurrentUser() reads only the caller's own row. Every other read and every
-- write uses createAdminClient() (service role), which bypasses RLS.
drop policy if exists gdo_members_all on greendogops.app_user;

create policy app_user_read_self on greendogops.app_user
  for select to authenticated
  using (id = auth.uid());

-- Same reasoning for the credential vault and the one-off merge backup: both
-- are service-role only by design (see 0007_credentials_vault.sql).
drop policy if exists gdo_members_all on greendogops.credential;
drop policy if exists gdo_members_all on greendogops.ats_hr_merge_backup_0032;

-- ---------------------------------------------------------------------------
-- 5. Views and materialized views cannot honour RLS — revoke API-role access
-- ---------------------------------------------------------------------------
-- A plain view runs with its owner's rights unless security_invoker is set, and
-- a matview is never RLS-checked at all, so leaving these granted would keep an
-- open read path around step 3. The app reads them with the service role.
do $$
declare
  v record;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'greendogops'
      and c.relkind in ('v', 'm')
  loop
    execute format('revoke all on greendogops.%I from anon, authenticated', v.relname);
  end loop;
end $$;
