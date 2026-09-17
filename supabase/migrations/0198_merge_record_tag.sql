-- ============================================================================
-- Green Dog Ops — 0198 merge_record_tag()
-- ----------------------------------------------------------------------------
-- Applies one tag pull to the membership table in a single statement: upsert
-- the catalog row, upsert the records returned, retire the ones that stopped
-- carrying the tag, and log the run.
--
-- The whole point is the retirement rule, which differs by mode:
--   backfill    the pull read EVERY record, so anything it did not return has
--               genuinely lost the tag.
--   incremental the pull only read records with recent activity, so absence
--               proves nothing for everyone else. Only records we can show were
--               in scope — their ezyVet modified date falls inside the window —
--               may be retired. Skipping that check would silently wipe the
--               whole membership on the first nightly run.
-- ============================================================================
set search_path = greendogops, public;

create or replace function greendogops.merge_record_tag(
  p_tag_key       text,
  p_tag_label     text,
  p_record_type   text,
  p_mode          text,
  p_run_on        date,
  p_records       jsonb,
  p_tag_type      text default 'pet_tag',
  p_tag_group     text default null,
  p_activity_from date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = greendogops, public, pg_temp
as $$
declare
  v_codes     text[];
  v_matched   integer := 0;
  v_added     integer := 0;
  v_confirmed integer := 0;
  v_removed   integer := 0;
  v_existing  integer := 0;
begin
  if p_mode not in ('backfill', 'incremental') then
    raise exception 'merge_record_tag: unknown mode %', p_mode;
  end if;
  if p_mode = 'incremental' and p_activity_from is null then
    raise exception 'merge_record_tag: an incremental run needs p_activity_from';
  end if;
  if p_record_type not in ('contact', 'animal') then
    raise exception 'merge_record_tag: unknown record type %', p_record_type;
  end if;

  select count(*) into v_existing
  from greendogops.ezyvet_record_tag
  where tag_key = p_tag_key and record_type = p_record_type and removed_on is null;

  select array_agg(distinct btrim(r->>'record_code'))
    into v_codes
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
  where nullif(btrim(r->>'record_code'), '') is not null;

  v_codes   := coalesce(v_codes, '{}');
  v_matched := array_length(v_codes, 1);
  v_matched := coalesce(v_matched, 0);

  -- A backfill that comes back empty for a tag that currently has members is
  -- almost always a broken export, and acting on it would retire the entire
  -- population. Refuse rather than destroy.
  if p_mode = 'backfill' and v_matched = 0 and v_existing > 0 then
    raise exception
      'merge_record_tag: backfill of % returned no records but % are currently tagged — refusing to retire them all',
      p_tag_key, v_existing;
  end if;

  insert into greendogops.ezyvet_tag
    (tag_key, tag_label, tag_type, tag_group, last_run_on, backfilled_on)
  values
    (p_tag_key, p_tag_label, coalesce(p_tag_type, 'pet_tag'), p_tag_group, p_run_on,
     case when p_mode = 'backfill' then p_run_on end)
  on conflict (tag_key) do update
    set tag_label     = excluded.tag_label,
        tag_type      = excluded.tag_type,
        tag_group     = coalesce(excluded.tag_group, greendogops.ezyvet_tag.tag_group),
        last_run_on   = excluded.last_run_on,
        backfilled_on = coalesce(excluded.backfilled_on, greendogops.ezyvet_tag.backfilled_on);

  with incoming as (
    select distinct on (btrim(r->>'record_code'))
           btrim(r->>'record_code')                as record_code,
           nullif(btrim(r->>'record_name'), '')    as record_name,
           nullif(btrim(r->>'contact_code'), '')   as contact_code,
           nullif(btrim(r->>'ezyvet_contact_id'), '') as ezyvet_contact_id,
           nullif(btrim(r->>'email'), '')          as email
    from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
    where nullif(btrim(r->>'record_code'), '') is not null
  ),
  up as (
    insert into greendogops.ezyvet_record_tag as m
      (tag_key, record_type, record_code, record_name, contact_code,
       ezyvet_contact_id, email, first_seen_on, last_confirmed_on)
    select p_tag_key, p_record_type, record_code, record_name, contact_code,
           ezyvet_contact_id, email, p_run_on, p_run_on
    from incoming
    on conflict (tag_key, record_type, record_code) do update
      set record_name       = coalesce(excluded.record_name, m.record_name),
          contact_code      = coalesce(excluded.contact_code, m.contact_code),
          ezyvet_contact_id = coalesce(excluded.ezyvet_contact_id, m.ezyvet_contact_id),
          email             = coalesce(excluded.email, m.email),
          last_confirmed_on = excluded.last_confirmed_on,
          -- A tag put back on a record revives the existing row; first_seen_on
          -- keeps the ORIGINAL date so the history is not rewritten.
          removed_on        = null,
          first_seen_on     = least(m.first_seen_on, excluded.first_seen_on)
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert),
         count(*) filter (where not was_insert)
    into v_added, v_confirmed
  from up;

  update greendogops.ezyvet_record_tag m
     set removed_on = p_run_on
   where m.tag_key = p_tag_key
     and m.record_type = p_record_type
     and m.removed_on is null
     and not (m.record_code = any (v_codes))
     and (
       p_mode = 'backfill'
       or (p_record_type = 'contact' and exists (
             select 1 from greendogops.ezyvet_contact c
              where c.contact_code = m.record_code
                and c.ezyvet_modified_at >= p_activity_from))
       or (p_record_type = 'animal' and exists (
             select 1 from greendogops.ezyvet_animal a
              where a.animal_code = m.record_code
                and a.ezyvet_modified_at >= p_activity_from))
     );
  get diagnostics v_removed = row_count;

  insert into greendogops.ezyvet_record_tag_run
    (tag_key, mode, activity_from, matched, added, confirmed, removed, ran_on)
  values
    (p_tag_key, p_mode, p_activity_from, v_matched, v_added, v_confirmed, v_removed, p_run_on);

  return jsonb_build_object(
    'tag_key', p_tag_key, 'mode', p_mode, 'matched', v_matched,
    'added', v_added, 'confirmed', v_confirmed, 'removed', v_removed
  );
end;
$$;

comment on function greendogops.merge_record_tag is
  'Apply one ezyVet tag pull: upsert catalog + membership, retire records that lost the tag (backfill = all, incremental = only records inside the activity window), log the run.';

revoke all on function greendogops.merge_record_tag(
  text, text, text, text, date, jsonb, text, text, date) from public, anon, authenticated;
grant execute on function greendogops.merge_record_tag(
  text, text, text, text, date, jsonb, text, text, date) to service_role;
