-- ============================================================================
-- Green Dog Ops — 0160 Smart Report (ask-a-question reporting)
-- ----------------------------------------------------------------------------
-- The Smart Report page lets an admin ask a plain-English question ("average
-- patient age", "revenue in July") and answers it by having an LLM write a
-- SELECT against this schema. Two helpers support that:
--
--   smart_schema()          -> table/column catalog fed to the model as context
--   smart_query(sql, limit) -> runs ONE read-only SELECT and returns jsonb rows
--
-- Safety (defence in depth — the model's SQL is never trusted):
--   1. Both functions are SECURITY INVOKER and EXECUTE is granted ONLY to
--      service_role. They are unreachable from the browser/anon key; the server
--      action calls them with the service-role client *after* checking that the
--      caller is an admin with the reporting module.
--   2. smart_query is declared STABLE, so Postgres itself refuses to run any
--      INSERT/UPDATE/DELETE inside it.
--   3. The statement must start with SELECT/WITH, may not contain a second
--      statement, and is rejected on a disallowed keyword.
--   4. It is wrapped as a sub-select (blocks data-modifying CTEs) with a hard
--      row limit and a 20s statement_timeout.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- Schema catalog: every table/view/matview the caller can read, with columns.
-- ---------------------------------------------------------------------------
create or replace function greendogops.smart_schema()
returns jsonb
language sql
stable
security invoker
set search_path = greendogops, public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', t.relname, 'kind', t.kind, 'columns', t.cols)
      order by t.relname
    ),
    '[]'::jsonb
  )
  from (
    select
      c.relname,
      case c.relkind when 'v' then 'view' when 'm' then 'matview' else 'table' end as kind,
      jsonb_agg(
        jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod))
        order by a.attnum
      ) as cols
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'greendogops'
      and c.relkind in ('r', 'p', 'v', 'm')
      and has_table_privilege(c.oid, 'select')
    group by c.relname, c.relkind
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- Read-only query runner.
-- ---------------------------------------------------------------------------
create or replace function greendogops.smart_query(p_sql text, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security invoker
set search_path = greendogops, public, pg_temp
set statement_timeout = '20s'
as $$
declare
  v_sql   text := btrim(coalesce(p_sql, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_out   jsonb;
begin
  v_sql := btrim(regexp_replace(v_sql, ';+\s*$', ''));

  if v_sql = '' then
    raise exception 'empty query';
  end if;
  if v_sql !~* '^(with|select)\s' then
    raise exception 'only SELECT queries are allowed';
  end if;
  if v_sql like '%;%' then
    raise exception 'only a single statement is allowed';
  end if;
  if v_sql ~* '\m(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|refresh|reindex|merge|call|do|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_terminate_backend|dblink|set_config|current_setting|lo_import|lo_export)\M' then
    raise exception 'query contains a disallowed keyword';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from (select * from (%s) q limit %s) r',
    v_sql,
    v_limit
  )
  into v_out;

  return v_out;
end;
$$;

revoke all on function greendogops.smart_schema() from public, anon, authenticated;
revoke all on function greendogops.smart_query(text, integer) from public, anon, authenticated;
grant execute on function greendogops.smart_schema() to service_role;
grant execute on function greendogops.smart_query(text, integer) to service_role;

comment on function greendogops.smart_query(text, integer) is
  'Smart Report: runs one read-only SELECT and returns jsonb rows. service_role only.';
comment on function greendogops.smart_schema() is
  'Smart Report: table/column catalog used as LLM context. service_role only.';
