-- ============================================================================
-- 0165 — Keep new objects protected by default
--
-- 0001_init_schema.sql left `alter default privileges in schema greendogops
-- grant select,insert,update,delete on tables to authenticated` in place, so a
-- table added by a future migration is granted to every one of the ~102 shared
-- auth.users the moment it is created. Before 0164 that was the whole problem;
-- without a guardrail it would quietly come back one table at a time.
--
-- This adds an event trigger that applies the 0164 baseline automatically:
--   * new table  -> RLS enabled + the standard gdo_members_all policy
--   * new view / matview -> revoked from anon + authenticated (neither can
--     enforce RLS, so they are service-role only by convention)
-- plus greendogops.rls_audit() so the invariant can be checked on demand.
-- ============================================================================

create or replace function greendogops.protect_new_objects()
returns event_trigger
language plpgsql
security definer
set search_path = greendogops, pg_catalog
as $$
declare
  cmd record;
  obj_schema text;
  obj_name text;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.schema_name is distinct from 'greendogops' then
      continue;
    end if;

    select n.nspname, c.relname into obj_schema, obj_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.oid = cmd.objid;

    if obj_name is null then
      continue;
    end if;

    if cmd.command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') then
      execute format('alter table greendogops.%I enable row level security', obj_name);
      execute format(
        'create policy gdo_members_all on greendogops.%I '
        'for all to authenticated '
        'using (greendogops.is_gdo_user()) '
        'with check (greendogops.is_gdo_user())',
        obj_name
      );
      raise notice 'greendogops.%: RLS enabled with gdo_members_all policy', obj_name;

    elsif cmd.command_tag in ('CREATE VIEW', 'CREATE MATERIALIZED VIEW') then
      execute format('revoke all on greendogops.%I from anon, authenticated', obj_name);
      raise notice 'greendogops.%: revoked from anon/authenticated (read it with the service role)', obj_name;
    end if;
  end loop;
end;
$$;

comment on function greendogops.protect_new_objects() is
  'Event-trigger body: applies the migration 0164 RLS baseline to newly created greendogops tables/views.';

drop event trigger if exists greendogops_protect_new_objects;
create event trigger greendogops_protect_new_objects
  on ddl_command_end
  when tag in (
    'CREATE TABLE',
    'CREATE TABLE AS',
    'SELECT INTO',
    'CREATE VIEW',
    'CREATE MATERIALIZED VIEW'
  )
  execute function greendogops.protect_new_objects();

-- ---------------------------------------------------------------------------
-- On-demand audit: returns a row for anything reachable by anon/authenticated
-- that is not protected. Should always return zero rows.
-- ---------------------------------------------------------------------------
create or replace function greendogops.rls_audit()
returns table (object_name text, object_kind text, problem text)
language sql
stable
set search_path = greendogops, pg_catalog
as $$
  select c.relname::text,
         'table',
         case when not c.relrowsecurity then 'RLS disabled'
              else 'RLS enabled but no policy' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'greendogops'
    and c.relkind = 'r'
    and (
      not c.relrowsecurity
      or not exists (select 1 from pg_policies p
                     where p.schemaname = 'greendogops' and p.tablename = c.relname)
    )
    -- service-role-only by design (0164)
    and c.relname not in ('credential', 'ats_hr_merge_backup_0032')

  union all

  select c.relname::text,
         case c.relkind when 'm' then 'matview' else 'view' end,
         'granted to ' || g.grantee
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join information_schema.role_table_grants g
    on g.table_schema = n.nspname and g.table_name = c.relname
  where n.nspname = 'greendogops'
    and c.relkind in ('v', 'm')
    and g.grantee in ('anon', 'authenticated')
  group by c.relname, c.relkind, g.grantee

  union all

  select g.table_name::text, 'table', 'granted to anon'
  from information_schema.role_table_grants g
  where g.table_schema = 'greendogops'
    and g.grantee = 'anon'
  group by g.table_name;
$$;

comment on function greendogops.rls_audit() is
  'Returns every greendogops object still reachable by anon/authenticated without RLS. Expect zero rows.';

revoke all on function greendogops.rls_audit() from public;
grant execute on function greendogops.rls_audit() to service_role;
