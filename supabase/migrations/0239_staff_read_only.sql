-- ============================================================================
-- Green Dog Ops — 0239 Staff is the employee role, read-only in the database
-- ----------------------------------------------------------------------------
-- The owner confirmed (2026-10-13) that Staff IS the employee role: every
-- rostered employee has an active Staff login (75 since the bulk provisioning
-- the same day). 0238 had added a separate 'employee' role for self-service
-- logins; it is retired here, and the database restriction moves to Staff.
--
-- 1. Staff are read-only through the API. Every greendogops table gets three
--    RESTRICTIVE policies (insert / update / delete) that refuse an active
--    Staff login. Restrictive policies are ANDed with the existing permissive
--    ones, so every other role, and every narrower policy (HR file 0227,
--    policy documents 0235, Recruiting 0237), is unchanged. Staff still READ
--    what gdo_members_all allows. The app never writes as Staff through the
--    user client except Med Ops boards, which now write with the service role
--    after ensureBoardUser(). The service role bypasses RLS.
-- 2. protect_new_objects() adds the same policies to every new table, and
--    rls_audit() reports any table without them.
-- 3. The 'employee' role is retired: is_gdo_user() and the
--    resource_document.visible_roles check go back to their pre-0238 form,
--    and app_user may no longer use 'employee' (or the long-unused 'viewer').
--    Enum values cannot be dropped, so both remain in app_role, unusable.
--    0238's revoke of `authenticated` EXECUTE on SECURITY DEFINER functions
--    and its rls_audit() check are kept.
-- ============================================================================

set search_path = greendogops, public;

begin;

-- 1. ------------------------------------------------------------------------
create or replace function greendogops.staff_read_only_policies(p_table text)
  returns void
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $fn$
declare
  not_staff constant text :=
    'not exists (select 1 from greendogops.app_user u where u.id = auth.uid() '
    'and u.is_active and u.role::text = ''staff'')';
begin
  execute format('drop policy if exists staff_read_only_insert on greendogops.%I', p_table);
  execute format('drop policy if exists staff_read_only_update on greendogops.%I', p_table);
  execute format('drop policy if exists staff_read_only_delete on greendogops.%I', p_table);
  execute format(
    'create policy staff_read_only_insert on greendogops.%I as restrictive for insert to authenticated with check (%s)',
    p_table, not_staff);
  execute format(
    'create policy staff_read_only_update on greendogops.%I as restrictive for update to authenticated using (%s) with check (%s)',
    p_table, not_staff, not_staff);
  execute format(
    'create policy staff_read_only_delete on greendogops.%I as restrictive for delete to authenticated using (%s)',
    p_table, not_staff);
end;
$fn$;

comment on function greendogops.staff_read_only_policies(text) is
  'Adds the three RESTRICTIVE staff_read_only_* policies (0239) to one greendogops table: an active Staff login cannot insert, update or delete through the API. Called by protect_new_objects() for every new table.';

revoke all on function greendogops.staff_read_only_policies(text) from public, anon, authenticated;
grant execute on function greendogops.staff_read_only_policies(text) to service_role;

do $$
declare
  t text;
  n integer := 0;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'greendogops'
      and c.relkind = 'r'
      and c.relrowsecurity
    order by 1
  loop
    perform greendogops.staff_read_only_policies(t);
    n := n + 1;
  end loop;
  raise notice 'staff_read_only policies on % tables', n;
end
$$;

-- 2. ------------------------------------------------------------------------
create or replace function greendogops.protect_new_objects() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'greendogops', 'pg_catalog'
    AS $$
declare
  cmd record;
  obj_schema text;
  obj_name text;
  fn_sig text;
  fn_has_search_path boolean;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.schema_name is distinct from 'greendogops' then
      continue;
    end if;

    if cmd.command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE') then
      select format('%I.%I(%s)', n.nspname, p.proname,
                    pg_get_function_identity_arguments(p.oid)),
             p.proconfig is not null
               and exists (select 1 from unnest(p.proconfig) c
                            where c like 'search_path=%')
        into fn_sig, fn_has_search_path
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.oid = cmd.objid;

      if fn_sig is null then
        continue;
      end if;

      execute format('revoke all on routine %s from public, anon', fn_sig);
      execute format('grant execute on routine %s to service_role', fn_sig);

      if not fn_has_search_path then
        execute format('alter function %s set search_path = greendogops, public, pg_temp', fn_sig);
      end if;

      raise notice '%: EXECUTE revoked from public/anon (service role only; grant authenticated explicitly if a page needs it)', fn_sig;
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
      -- 0239: Staff are read-only in the database.
      perform greendogops.staff_read_only_policies(obj_name);
      raise notice 'greendogops.%: RLS enabled with gdo_members_all policy (Staff read-only)', obj_name;

    elsif cmd.command_tag in ('CREATE VIEW', 'CREATE MATERIALIZED VIEW') then
      execute format('revoke all on greendogops.%I from anon, authenticated', obj_name);
      raise notice 'greendogops.%: revoked from anon/authenticated (read it with the service role)', obj_name;
    end if;
  end loop;
end;
$$;


comment on function greendogops.protect_new_objects() is
  'Event-trigger body: applies the migration 0164 RLS baseline to newly created greendogops tables/views, plus the 0239 Staff read-only policies.';

create or replace function greendogops.rls_audit()
  returns table(object_name text, object_kind text, problem text)
  language sql stable
  set search_path to 'greendogops', 'pg_catalog'
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
  group by g.table_name

  union all

  -- 0211: anon must not be able to call anything in greendogops.
  select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
         'function',
         'EXECUTE granted to anon'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'greendogops'
    and p.prokind in ('f', 'p')
    and has_function_privilege('anon', p.oid, 'EXECUTE')

  union all

  -- 0238: a SECURITY DEFINER function bypasses RLS, so `authenticated` (which
  -- includes EmployeeGMGDD logins) must not call one directly.
  -- The two policy helpers are the only exceptions.
  select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
         'function',
         'SECURITY DEFINER executable by authenticated'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'greendogops'
    and p.prokind in ('f', 'p')
    and p.prosecdef
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and p.proname not in ('is_gdo_user', 'is_gdo_admin')
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')

  union all

  -- 0239: Staff are read-only in the database. Every table carries the three
  -- restrictive staff_read_only_* policies (protect_new_objects adds them).
  select c.relname::text, 'table', 'Staff not read-only (missing staff_read_only_* policies)'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'greendogops'
    and c.relkind = 'r'
    and c.relrowsecurity
    and c.relname not in ('credential', 'ats_hr_merge_backup_0032')
    and (select count(*) from pg_policies p
          where p.schemaname = 'greendogops' and p.tablename = c.relname
            and p.permissive = 'RESTRICTIVE'
            and p.policyname in ('staff_read_only_insert', 'staff_read_only_update', 'staff_read_only_delete')) < 3

  union all

  select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)),
         'function',
         'search_path not pinned'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'greendogops'
    and p.prokind in ('f', 'p')
    and not (p.proconfig is not null
             and exists (select 1 from unnest(p.proconfig) c
                          where c like 'search_path=%'));
$$;

revoke all on function greendogops.rls_audit() from public, anon, authenticated;
grant execute on function greendogops.rls_audit() to service_role;

comment on function greendogops.rls_audit() is
  'Returns every greendogops object still reachable by anon/authenticated without RLS (including SECURITY DEFINER functions authenticated can call, and tables Staff could write). Expect zero rows.';

-- 3. ------------------------------------------------------------------------
create or replace function greendogops.is_gdo_user() returns boolean
  language sql stable security definer
  set search_path to 'greendogops', 'pg_catalog'
as $$
  select exists (
    select 1
    from greendogops.app_user
    where id = auth.uid()
      and is_active
  )
  and (
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status = 'verified'
    )
  );
$$;

comment on function greendogops.is_gdo_user() is
  'True when the current JWT belongs to an active greendogops.app_user. auth.users is shared with EmployeeGMGDD, so a session alone is NOT sufficient.';

alter table greendogops.resource_document
  drop constraint if exists resource_document_visible_roles_valid;
alter table greendogops.resource_document
  add constraint resource_document_visible_roles_valid check (
    visible_roles is null
    or visible_roles <@ array['owner', 'admin', 'executive', 'manager',
                              'schedule_admin', 'marketing_admin', 'staff']
  );

alter table greendogops.app_user
  drop constraint if exists app_user_role_supported;
alter table greendogops.app_user
  add constraint app_user_role_supported
  check (role::text not in ('employee', 'viewer'));

comment on constraint app_user_role_supported on greendogops.app_user is
  'employee (0238, retired by 0239) and viewer are unused app_role values; Staff is the employee role.';

commit;
