-- ============================================================================
-- 0166 — Merge the duplicate "Aetna" location into "Van Nuys"
--
-- 14661 Aetna St IS the Van Nuys clinic; "Aetna" and "Van Nuys" are just two
-- names for the same site (confirmed by the team). Two location rows existed:
--   Aetna    (AET) is_active = false  — 1 referencing row
--   Van Nuys (VAN) is_active = true   — used by the boards, agenda and schedule
-- The staff schedule sheet writes "AETNA", so keeping both invites future rows
-- being split across two ids. Van Nuys is canonical.
-- ============================================================================

do $$
declare
  v_aetna uuid;
  v_vannuys uuid;
begin
  select id into v_aetna   from greendogops.location where name = 'Aetna'    limit 1;
  select id into v_vannuys from greendogops.location where name = 'Van Nuys' limit 1;

  if v_aetna is null or v_vannuys is null then
    raise notice 'Aetna/Van Nuys merge: nothing to do';
    return;
  end if;

  -- Only sched_week_location referenced Aetna. Repoint it, unless the week
  -- already lists Van Nuys, in which case the row is a duplicate.
  delete from greendogops.sched_week_location a
   where a.location_id = v_aetna
     and exists (
       select 1 from greendogops.sched_week_location b
        where b.week_id = a.week_id and b.location_id = v_vannuys
     );
  update greendogops.sched_week_location
     set location_id = v_vannuys
   where location_id = v_aetna;

  delete from greendogops.location where id = v_aetna;
  raise notice 'Aetna merged into Van Nuys';
end $$;

-- Record the alternate name so "AETNA" in the staff schedule sheet still
-- resolves, without needing a second location row.
comment on table greendogops.location is
  'Clinic locations. "Van Nuys" is also referred to as "Aetna" (14661 Aetna St) — the staff schedule sheet uses AETNA; both mean this one row.';
