-- ============================================================================
-- Green Dog Ops — 0238 Employee role (self-service only)
-- ----------------------------------------------------------------------------
-- Every active employee is about to get a login for the self-service portal
-- (time clock, own schedule, own timecard, PTO). Those logins must reach
-- nothing else through the PostgREST API.
--
-- 1. app_role gains 'employee'.
-- 2. is_gdo_user() is false for role 'employee'. Every gdo_members_all policy
--    and every role-aware policy (0227, 0235, 0237) is ANDed with
--    is_gdo_user(), so an employee token reads and writes no greendogops table.
--    It can still read its own app_user row (app_user_read_self), which the
--    app needs to resolve the session. All self-service reads and writes are
--    Server Actions that use the service role, scoped to the caller's own
--    person_id.
-- 3. SECURITY DEFINER functions run as their owner and never consult RLS, so
--    a definer function callable by `authenticated` is a bypass of (2) — and,
--    because auth.users is shared with EmployeeGMGDD, of the whole GDO floor.
--    28 such functions (reporting, Med Ops boards, referral uploads, QR and
--    refresh helpers) were callable by any signed-in Supabase user with no
--    is_gdo_user() check. EXECUTE is revoked from `authenticated`; the app
--    now calls them with the service role after its own module checks.
--    is_gdo_user() and is_gdo_admin() stay callable: RLS policies use them.
-- 4. resource_document.visible_roles accepts 'employee'.
-- 5. rls_audit() also reports any SECURITY DEFINER function `authenticated`
--    can execute, so (3) cannot silently regress.
--
-- 'employee' is compared as text below: a value added by ALTER TYPE … ADD
-- VALUE cannot be used as an enum literal in the same transaction.
-- ============================================================================

alter type greendogops.app_role add value if not exists 'employee';

set search_path = greendogops, public;

begin;

-- 2. ------------------------------------------------------------------------
create or replace function greendogops.is_gdo_user() returns boolean
  language sql stable security definer
  set search_path to 'greendogops', 'pg_catalog'
as $$
  select exists (
    select 1
    from greendogops.app_user
    where id = auth.uid()
      and is_active
      and role::text <> 'employee'
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
  'True when the current JWT belongs to an active greendogops.app_user whose role is not employee (and who has passed two-step verification if enrolled). auth.users is shared with EmployeeGMGDD, so a session alone is NOT sufficient. Employee (self-service) logins are served only through service-role Server Actions.';

-- 3. ------------------------------------------------------------------------
do $$
declare
  sig text;
begin
  for sig in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'greendogops'
      and p.prokind in ('f', 'p')
      and p.prosecdef
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and p.proname not in ('is_gdo_user', 'is_gdo_admin')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by 1
  loop
    execute format('revoke execute on routine %s from public, authenticated', sig);
    execute format('grant execute on routine %s to service_role', sig);
    raise notice '%: EXECUTE revoked from authenticated (service role only)', sig;
  end loop;
end
$$;

-- 4. ------------------------------------------------------------------------
alter table greendogops.resource_document
  drop constraint if exists resource_document_visible_roles_valid;
alter table greendogops.resource_document
  add constraint resource_document_visible_roles_valid check (
    visible_roles is null
    or visible_roles <@ array['owner', 'admin', 'executive', 'manager',
                              'schedule_admin', 'marketing_admin', 'staff',
                              'employee']
  );

-- 5. ------------------------------------------------------------------------
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
  -- includes EmployeeGMGDD and employee logins) must not call one directly.
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
  'Returns every greendogops object still reachable by anon/authenticated without RLS (including SECURITY DEFINER functions authenticated can call). Expect zero rows.';

commit;
