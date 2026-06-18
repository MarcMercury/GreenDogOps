-- ============================================================================
-- Green Dog Ops — 0016 Reconcile clinic locations with Settings
-- ----------------------------------------------------------------------------
-- The admin Settings list (`app_setting` key `org.locations`) is the single
-- source of truth for clinic locations. The scheduler reads from the canonical
-- `greendogops.location` table (it needs stable IDs), which was previously
-- seeded with its own hard-coded set (incl. a stale "San Marino" entry).
--
-- This migration mirrors the Settings list into `location`:
--   * names present in Settings are upserted as active, ordered by position;
--   * locations missing from Settings are soft-deactivated (rows are kept so
--     historical schedule assignments keep their foreign keys).
-- ============================================================================
set search_path = greendogops, public;

do $$
declare
  loc_names text[];
  nm        text;
  idx       int := 0;
begin
  -- Pull the Settings list (jsonb array of names) as a text[].
  select array(select jsonb_array_elements_text(value))
    into loc_names
    from greendogops.app_setting
   where key = 'org.locations';

  if loc_names is null then
    loc_names := '{}';
  end if;

  -- Deactivate any location that is no longer in Settings.
  update greendogops.location l
     set is_active  = false,
         updated_at = now()
   where l.is_active
     and not exists (
           select 1
             from unnest(loc_names) n
            where lower(trim(n)) = lower(l.name)
         );

  -- Activate / insert each Settings location in order.
  foreach nm in array loc_names loop
    nm := trim(nm);
    continue when nm = '';

    if exists (select 1 from greendogops.location where lower(name) = lower(nm)) then
      update greendogops.location
         set is_active  = true,
             sort_order = idx,
             updated_at = now()
       where lower(name) = lower(nm);
    else
      insert into greendogops.location (name, is_active, sort_order)
      values (nm, true, idx);
    end if;

    idx := idx + 10;
  end loop;
end $$;
