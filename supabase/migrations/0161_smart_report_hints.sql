-- ============================================================================
-- Green Dog Ops — 0161 Smart Report: value hints + row counts
-- ----------------------------------------------------------------------------
-- WHY: the model was only given table/column NAMES, so it had no idea what the
-- stored VALUES look like. "Average age of the dogs" was written as
--   where species = 'Dog'
-- but ezyvet_animal.species is stored as 'Canine (dog)' — the query matched
-- zero rows and the answer came back "unknown" even though 40,428 patients have
-- a date_of_birth. Same trap exists for location_key, division, person.status,
-- sex, product_group, etc.
--
-- Two changes:
--   1. smart_schema() now reports an estimated row count per object, so the
--      model can tell a populated table from an empty one.
--   2. smart_value_hints() returns the actual vocabulary of every low-cardinality
--      text/boolean column in the schema. It reads the planner statistics
--      (pg_stats.most_common_vals) rather than scanning tables, so it is
--      effectively free and covers EVERY table/matview in the database at once.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- Schema catalog: every table/view/matview the caller can read, with columns
-- and an estimated row count (-1 => never analysed, reported as null).
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
      jsonb_build_object('name', t.relname, 'kind', t.kind, 'rows', t.rows, 'columns', t.cols)
      order by t.relname
    ),
    '[]'::jsonb
  )
  from (
    select
      c.relname,
      case c.relkind when 'v' then 'view' when 'm' then 'matview' else 'table' end as kind,
      case when c.reltuples < 0 then null else c.reltuples::bigint end as rows,
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
    group by c.relname, c.relkind, c.reltuples
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- Value vocabulary for low-cardinality columns.
--
-- pg_stats is itself security-barriered (a caller only sees statistics for
-- tables it may read), and we further restrict to short text/boolean columns
-- and drop anything whose name looks like a credential, so no secret ever
-- reaches the model.
-- ---------------------------------------------------------------------------
create or replace function greendogops.smart_value_hints(p_max_distinct integer default 40)
returns jsonb
language sql
stable
security invoker
set search_path = greendogops, public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('table', h.tablename, 'column', h.attname, 'values', h.vals)
      order by h.tablename, h.attname
    ),
    '[]'::jsonb
  )
  from (
    select
      s.tablename,
      s.attname,
      (
        select jsonb_agg(left(v, 60) order by ord)
        from (
          select v, ord
          from unnest(s.most_common_vals::text::text[]) with ordinality u(v, ord)
          where v is not null and v <> '' and length(v) <= 60
          order by ord
          limit 40
        ) x
      ) as vals
    from pg_stats s
    join pg_class c on c.relname = s.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = s.schemaname
    join pg_attribute a on a.attrelid = c.oid and a.attname = s.attname
    join pg_type ty on ty.oid = a.atttypid
    where s.schemaname = 'greendogops'
      and c.relkind in ('r', 'p', 'm')
      and s.most_common_vals is not null
      and s.n_distinct between 1 and greatest(coalesce(p_max_distinct, 40), 1)
      -- booleans carry no vocabulary worth spending prompt tokens on
      and ty.typname in ('text', 'varchar', 'bpchar')
      and s.attname !~* '(password|secret|token|api_key|access_key|private|ssn|hash|salt)'
  ) h
  where h.vals is not null;
$$;

revoke all on function greendogops.smart_value_hints(integer) from public, anon, authenticated;
grant execute on function greendogops.smart_value_hints(integer) to service_role;

comment on function greendogops.smart_value_hints(integer) is
  'Smart Report: distinct-value vocabulary for low-cardinality text columns, read from planner stats. service_role only.';
