-- ---------------------------------------------------------------------------
-- Smart Report: remove the 200/1000 row cap.
--
-- smart_query() used to clamp the result to 1000 rows (default 200), so a
-- question like "list every client in Venice" silently returned a truncated
-- answer. The caller now decides: p_limit null or <= 0 means NO limit, any
-- positive value is applied as given.
--
-- Safety is unchanged: still SECURITY INVOKER, still STABLE (Postgres refuses
-- DML), still one SELECT-only statement with the keyword blacklist. The
-- statement timeout goes 20s -> 60s so a large list has time to come back.
-- ---------------------------------------------------------------------------

create or replace function greendogops.smart_query(p_sql text, p_limit integer default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = greendogops, public, pg_temp
set statement_timeout = '60s'
as $$
declare
  v_sql   text := btrim(coalesce(p_sql, ''));
  v_limit integer := case when coalesce(p_limit, 0) > 0 then p_limit else null end;
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
    'select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from (select * from (%s) q %s) r',
    v_sql,
    case when v_limit is null then '' else format('limit %s', v_limit) end
  )
  into v_out;

  return v_out;
end;
$$;

revoke all on function greendogops.smart_query(text, integer) from public, anon, authenticated;
grant execute on function greendogops.smart_query(text, integer) to service_role;

comment on function greendogops.smart_query(text, integer) is
  'Smart Report: runs one read-only SELECT and returns jsonb rows. No row cap unless p_limit > 0. service_role only.';
