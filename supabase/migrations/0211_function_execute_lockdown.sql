-- 0211_function_execute_lockdown.sql
--
-- Supabase advisor: 0028 anon_security_definer_function_executable
--                   0011 function_search_path_mutable
--
-- 0164 revoked anon's TABLE grants, but Postgres grants EXECUTE to PUBLIC on
-- every new function and anon inherits PUBLIC. So anon still reached 35
-- SECURITY DEFINER functions in greendogops through /rest/v1/rpc/*. A
-- SECURITY DEFINER function runs as its owner and never consults RLS, so that
-- was a complete read/write bypass of the 0164 baseline using nothing but the
-- publishable anon key.
--
-- The 12 service-role-only functions (smart_*, merge_person, merge_record_tag,
-- record_qr_scan, rls_audit, search_resource_content) must NOT gain an
-- `authenticated` grant here, so the sweep below preserves each function's
-- existing authenticated privilege instead of blanket-granting it.

begin;

-- ---------------------------------------------------------------------------
-- 1. public.exec_sql(text) — `EXECUTE sql_text` as postgres (which has
--    rolbypassrls), reachable at /rest/v1/rpc/exec_sql by anon. Arbitrary SQL
--    against every schema in the project for anyone holding the anon key.
--    Unreferenced in src/. The service role keeps it; the two API roles lose it.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.exec_sql(text)') is not null then
    revoke all on routine public.exec_sql(text) from public, anon, authenticated;
    grant execute on routine public.exec_sql(text) to service_role;
    -- Mirrors the session default minus "$user", so unqualified SQL passed by
    -- existing service-role callers still resolves.
    alter function public.exec_sql(text)
      set search_path = public, extensions, pg_catalog, pg_temp;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. greendogops — PUBLIC (and therefore anon) loses EXECUTE on every routine.
-- ---------------------------------------------------------------------------
do $$
declare
  all_sigs  text[];
  auth_sigs text[];
  sig       text;
begin
  select array_agg(s.sig),
         array_agg(s.sig) filter (where s.keeps_auth)
    into all_sigs, auth_sigs
  from (
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as keeps_auth
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'greendogops'
      and p.prokind in ('f', 'p')
  ) s;

  foreach sig in array coalesce(all_sigs, '{}'::text[]) loop
    execute format('revoke all on routine %s from public, anon', sig);
    execute format('grant execute on routine %s to service_role', sig);
  end loop;

  foreach sig in array coalesce(auth_sigs, '{}'::text[]) loop
    execute format('grant execute on routine %s to authenticated', sig);
  end loop;

  raise notice '0211: locked % greendogops routines (% kept for authenticated)',
    coalesce(array_length(all_sigs, 1), 0),
    coalesce(array_length(auth_sigs, 1), 0);
end;
$$;

-- Future functions created by postgres must not inherit the PUBLIC grant.
alter default privileges in schema greendogops revoke execute on routines from public;
alter default privileges in schema greendogops revoke execute on routines from anon;

-- ---------------------------------------------------------------------------
-- 3. Pin search_path on the greendogops helpers that still resolve it at call
--    time. All 41 SECURITY DEFINER functions already pin it; these 19 are
--    SECURITY INVOKER helpers and triggers. None reference the extensions
--    schema, so the house convention applies.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
  n int := 0;
begin
  for fn in
    select format('%I.%I(%s)', ns.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'greendogops'
      and p.prokind in ('f', 'p')
      and not (p.proconfig is not null
               and exists (select 1 from unnest(p.proconfig) c
                            where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = greendogops, public, pg_temp', fn.sig);
    n := n + 1;
  end loop;

  raise notice '0211: pinned search_path on % greendogops functions', n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Keep it that way. 0165's event trigger already protects new tables and
--    views; extend it to functions so a new RPC cannot land anon-callable.
--    New functions are service-role-only by default and fail loudly for
--    signed-in users, which is the safe direction — grant `authenticated`
--    explicitly in the migration that creates the function when it is needed.
-- ---------------------------------------------------------------------------
create or replace function greendogops.protect_new_objects()
returns event_trigger
language plpgsql
security definer
set search_path to 'greendogops', 'pg_catalog'
as $function$
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
      raise notice 'greendogops.%: RLS enabled with gdo_members_all policy', obj_name;

    elsif cmd.command_tag in ('CREATE VIEW', 'CREATE MATERIALIZED VIEW') then
      execute format('revoke all on greendogops.%I from anon, authenticated', obj_name);
      raise notice 'greendogops.%: revoked from anon/authenticated (read it with the service role)', obj_name;
    end if;
  end loop;
end;
$function$;

-- 0165 created the event trigger with an explicit tag list, so it has to be
-- rebuilt to see CREATE FUNCTION / CREATE PROCEDURE at all.
drop event trigger if exists greendogops_protect_new_objects;
create event trigger greendogops_protect_new_objects
  on ddl_command_end
  when tag in (
    'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO',
    'CREATE VIEW', 'CREATE MATERIALIZED VIEW',
    'CREATE FUNCTION', 'CREATE PROCEDURE'
  )
  execute function greendogops.protect_new_objects();

-- ---------------------------------------------------------------------------
-- 5. rls_audit() now also reports anon-callable routines and unpinned
--    search_path, so `select * from greendogops.rls_audit();` stays the single
--    "expect zero rows" check.
-- ---------------------------------------------------------------------------
create or replace function greendogops.rls_audit()
returns table(object_name text, object_kind text, problem text)
language sql
stable
set search_path to 'greendogops', 'pg_catalog'
as $function$
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
$function$;

commit;
