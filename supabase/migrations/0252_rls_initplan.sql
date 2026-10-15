-- ============================================================================
-- Green Dog Ops — 0252 RLS: evaluate auth.uid() / is_gdo_user() once per query
-- ----------------------------------------------------------------------------
-- 707 of 735 greendogops policies called auth.uid() or
-- greendogops.is_gdo_user() bare, so Postgres re-ran them for EVERY row it
-- checked. is_gdo_user() alone reads app_user, auth.mfa_factors and the JWT.
-- Wrapped in a scalar subquery — (select auth.uid()) — the planner runs the
-- call once per statement as an initPlan (Supabase's RLS performance guidance).
-- Both functions are STABLE, so the value is the same for every row of a
-- statement and the policies keep exactly the same meaning.
--
-- Measured on production 2026-10-15 (rolled-back probe as `authenticated`):
-- count(*) on sched_assignment (12k rows) 357 ms with the bare policy vs
-- 2.3 ms for the wrapped check.
--
-- 1. staff_read_only_policies() and protect_new_objects() generate the
--    wrapped form, so tables created later get it too.
-- 2. Every existing policy is rewritten in place with ALTER POLICY (name,
--    command, roles and permissive/restrictive are untouched). Idempotent:
--    an already-wrapped call is preceded by "SELECT " and is skipped.
-- 3. The migration fails if any bare call is left.
-- ============================================================================

set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1a. Staff read-only policies (0239)
-- ---------------------------------------------------------------------------
create or replace function greendogops.staff_read_only_policies(p_table text)
 returns void
 language plpgsql
 set search_path to 'greendogops', 'pg_catalog'
as $function$
declare
  not_staff constant text :=
    'not exists (select 1 from greendogops.app_user u where u.id = (select auth.uid()) '
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
$function$;

-- ---------------------------------------------------------------------------
-- 1b. Default policy on new tables (0165, 0239)
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
      -- 0252: (select …) so the check runs once per statement, not per row.
      execute format(
        'create policy gdo_members_all on greendogops.%I '
        'for all to authenticated '
        'using ((select greendogops.is_gdo_user())) '
        'with check ((select greendogops.is_gdo_user()))',
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. Rewrite existing policies
-- ---------------------------------------------------------------------------
-- pg_policies prints names on the search_path unqualified; with greendogops
-- on the path, is_gdo_user() would not match the pattern below. An empty path
-- makes every name print — and re-parse — schema-qualified.
set local search_path = '';

do $$
declare
  -- A call not already inside "( SELECT … )".
  bare constant text := '(?<!SELECT )(auth\.uid\(\)|greendogops\.is_gdo_user\(\))';
  r record;
  v_sql text;
  v_n integer := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'greendogops'
      and (coalesce(qual, '') ~ bare or coalesce(with_check, '') ~ bare)
  loop
    v_sql := format('alter policy %I on greendogops.%I', r.policyname, r.tablename);
    if r.qual is not null then
      v_sql := v_sql || format(' using (%s)', regexp_replace(r.qual, bare, '(select \1)', 'g'));
    end if;
    if r.with_check is not null then
      v_sql := v_sql || format(' with check (%s)', regexp_replace(r.with_check, bare, '(select \1)', 'g'));
    end if;
    execute v_sql;
    v_n := v_n + 1;
  end loop;
  raise notice '0252: rewrote % policies', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Nothing bare may remain
-- ---------------------------------------------------------------------------
do $$
declare
  bare constant text := '(?<!SELECT )(auth\.uid\(\)|greendogops\.is_gdo_user\(\))';
  v_left text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into v_left
  from pg_policies
  where schemaname = 'greendogops'
    and (coalesce(qual, '') ~ bare or coalesce(with_check, '') ~ bare);
  if v_left is not null then
    raise exception '0252: policies still call auth.uid()/is_gdo_user() per row: %', v_left;
  end if;
end $$;
