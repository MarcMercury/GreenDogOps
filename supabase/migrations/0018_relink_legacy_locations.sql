-- ============================================================================
-- Green Dog Ops — 0018 Re-link legacy locations (Aetna / San Marino)
-- ----------------------------------------------------------------------------
-- The admin Settings → Locations directory is the single source of truth for
-- clinic locations. Two legacy/stray locations must never appear anywhere in
-- the system again:
--
--   * "Aetna"      -> re-link every reference to "Van Nuys" (The Valley)
--   * "San Marino" -> re-link every reference to "Venice"
--
-- This migration re-points every foreign-key reference to the canonical row,
-- updates the credentials-vault location code, then deletes the stray location
-- rows so they can no longer surface in scheduling or anywhere else.
-- ============================================================================
set search_path = greendogops, public;

do $$
declare
  m     record;
  v_old uuid;
  v_new uuid;
begin
  for m in
    select * from (values
      ('aetna',      'van nuys'),
      ('san marino', 'venice')
    ) as t(old_name, new_name)
  loop
    select id into v_old from greendogops.location where lower(name) = m.old_name limit 1;
    select id into v_new from greendogops.location where lower(name) = m.new_name limit 1;

    -- Nothing to do if the stray row is absent or the canonical row is missing.
    if v_old is null or v_new is null or v_old = v_new then
      continue;
    end if;

    -- HR: person employment home location.
    update greendogops.person_employment
       set location_id = v_new
     where location_id = v_old;

    -- Scheduling: per-employee default location.
    update greendogops.sched_employee_setting
       set default_location_id = v_new
     where default_location_id = v_old;

    -- Locations directory: any mobile site parked at the stray location.
    update greendogops.location
       set parent_location_id = v_new
     where parent_location_id = v_old;

    -- Scheduling: week location list (unique on week_id, location_id).
    -- Drop the stray entry where the canonical one already exists for the week.
    delete from greendogops.sched_week_location wl
     where wl.location_id = v_old
       and exists (
             select 1 from greendogops.sched_week_location x
              where x.week_id = wl.week_id
                and x.location_id = v_new
           );
    update greendogops.sched_week_location
       set location_id = v_new
     where location_id = v_old;

    -- Scheduling: closures (unique on week_id, location_id, day_of_week).
    delete from greendogops.sched_closure c
     where c.location_id = v_old
       and exists (
             select 1 from greendogops.sched_closure x
              where x.week_id = c.week_id
                and x.location_id = v_new
                and x.day_of_week = c.day_of_week
           );
    update greendogops.sched_closure
       set location_id = v_new
     where location_id = v_old;

    -- Scheduling: assignments (cell index is non-unique, safe to repoint all).
    update greendogops.sched_assignment
       set location_id = v_new
     where location_id = v_old;

    -- Remove the stray location row for good.
    delete from greendogops.location where id = v_old;
  end loop;
end $$;

-- Credentials vault: the legacy text code "AETNA" refers to the Van Nuys
-- (The Valley) clinic — normalize it to the Van Nuys short code.
update greendogops.credential
   set location = 'VAN', updated_at = now()
 where upper(location) = 'AETNA';

-- Keep the legacy flat setting in sync (derived mirror of active locations).
update greendogops.app_setting
   set value = to_jsonb(array(
         select name
           from greendogops.location
          where is_active
          order by sort_order, name)),
       updated_at = now()
 where key = 'org.locations';
