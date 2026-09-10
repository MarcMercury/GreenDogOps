-- ============================================================================
-- Green Dog Ops — 0175 Broaden policy passage search
-- ----------------------------------------------------------------------------
-- websearch_to_tsquery() ANDs every term, so a real question ("who do I call
-- when I am running late?") only matched a passage containing ALL of those
-- words and returned almost nothing. Match on ANY term instead, then rank
-- all-terms-present passages first so precision is kept without losing recall.
-- ============================================================================
set search_path = greendogops, public;

create or replace function greendogops.search_resource_content(
  p_query text,
  p_limit integer default 8
)
returns table (
  document_id uuid,
  title       text,
  category    text,
  source_url  text,
  chunk_index integer,
  content     text,
  rank        real
)
language plpgsql
stable
security invoker
set search_path = greendogops, public
as $$
declare
  v_all tsquery := websearch_to_tsquery('english', coalesce(p_query, ''));
  v_any tsquery;
begin
  -- OR of every lexeme left after stemming and stop-word removal.
  select string_agg(quote_literal(lex), ' | ')::tsquery
    into v_any
    from unnest(tsvector_to_array(to_tsvector('english', coalesce(p_query, '')))) as lex;

  if v_any is null then
    return;
  end if;

  return query
    select d.id, d.title, d.category, d.source_url, c.chunk_index, c.content,
           ts_rank(c.tsv, v_any) as rank
      from greendogops.resource_document_chunk c
      join greendogops.resource_document d on d.id = c.document_id
     where d.is_active
       and c.tsv @@ v_any
     order by (v_all is not null and c.tsv @@ v_all) desc,
              ts_rank(c.tsv, v_any) desc,
              d.title, c.chunk_index
     limit greatest(1, least(coalesce(p_limit, 8), 25));
end;
$$;

revoke all on function greendogops.search_resource_content(text, integer) from public;
grant execute on function greendogops.search_resource_content(text, integer) to service_role;
