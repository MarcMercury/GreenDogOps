-- ============================================================================
-- Green Dog Ops — 0179 Smart Report: keyword guard ignores string literals
-- ----------------------------------------------------------------------------
-- smart_query() ran its disallowed-keyword regex over the RAW statement, so any
-- query whose FILTER TEXT contained a blacklisted word was rejected outright:
--   * appointment type 'Dr Call Back'            -> matched \mcall\M
--   * products 'DO NOT USE - ...' (14 of them)   -> matched \mdo\M
--   * products 'Copy MSU - ...' (13 of them)     -> matched \mcopy\M
--   * 'Tech House Call' / '2 Techs House Call'   -> matched \mcall\M
-- The user got "query contains a disallowed keyword" and the model burned all
-- four retries. The same applied to a semicolon inside a literal.
--
-- The checks now run against a copy with comments and single-quoted literals
-- stripped, so they see SQL CODE only. Dollar quoting is rejected outright
-- because it could otherwise hide a statement from the scan. Everything else
-- (single statement, must start with SELECT/WITH, STABLE so Postgres itself
-- blocks writes, service_role-only EXECUTE) is unchanged.
-- ============================================================================
set search_path = greendogops, public;

create or replace function greendogops.smart_query(
  p_sql   text,
  p_limit integer default null
)
returns jsonb
language plpgsql
stable
set search_path to 'greendogops', 'public', 'pg_temp'
set statement_timeout to '60s'
as $function$
declare
  v_sql   text := btrim(coalesce(p_sql, ''));
  v_limit integer := case when coalesce(p_limit, 0) > 0 then p_limit else null end;
  v_code  text;
  v_out   jsonb;
begin
  v_sql := btrim(regexp_replace(v_sql, ';+\s*$', ''));

  if v_sql = '' then
    raise exception 'empty query';
  end if;
  if v_sql !~* '^(with|select)\s' then
    raise exception 'only SELECT queries are allowed';
  end if;
  if v_sql ~ '\$[A-Za-z_0-9]*\$' then
    raise exception 'dollar-quoted strings are not allowed';
  end if;

  -- Comments and quoted literals are DATA, not code. Strip them before the
  -- structural checks so a value like 'DO NOT USE' cannot read as a keyword.
  v_code := regexp_replace(v_sql, '/\*.*?\*/', ' ', 'gs');
  v_code := regexp_replace(v_code, '--[^' || chr(10) || ']*', ' ', 'g');
  v_code := regexp_replace(v_code, $re$'(?:[^']|'')*'$re$, ' ', 'g');

  if v_code like '%;%' then
    raise exception 'only a single statement is allowed';
  end if;
  if v_code ~* '\m(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|refresh|reindex|merge|call|do|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_terminate_backend|dblink|set_config|current_setting|lo_import|lo_export)\M' then
    raise exception 'query contains a disallowed keyword';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from (select * from (%s) q %s) r',
    v_sql,
    case when v_limit is null then '' else format('limit %s', v_limit) end
  )
  into v_out;

  return v_out;
end;
$function$;
