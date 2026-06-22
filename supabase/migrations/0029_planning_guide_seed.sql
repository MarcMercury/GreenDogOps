-- ============================================================================
-- Green Dog Ops — 0029 Planning guide seed (SO, Van Nuys, Venice)
-- ----------------------------------------------------------------------------
-- Initial planning guides for the 3 main locations, derived from the
-- GDD planning guides workbook. Idempotent: a guide is skipped if one with
-- the same name already exists, so manual edits are never clobbered.
-- ============================================================================
set search_path = greendogops, public;

do $$
declare gid uuid; c_nad uuid; c_uc uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'SO — Standard Day (14 NADs)') then
    raise notice 'planning guide already exists, skipping: %', 'SO — Standard Day (14 NADs)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('SO — Standard Day (14 NADs)', 'a7347952-911a-4e77-94f5-30acd26cfd2e', '89ed75b7-6e66-4b03-b168-843921e4f4a3', 'Standard NAD day', '{}',
       540, 1020, 60, 0, null)
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'NAD / Clinic', '#2563eb', '14 NADs / OEs', 0) returning id into c_nad;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Urgent Care', '#d97706', '4 VEs + 3 UCs', 10) returning id into c_uc;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 780, 60, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 'drop', 'Drop Off 9-11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 've', 'VE 9:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 600, 60, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 'uc', 'UC 11:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 've', 'VE 12:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 'uc', 'UC 2pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 'uc', 'UC 3pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 960, 60, 've', 'VE 4pm', 0);
  end if;
end $$;

do $$
declare gid uuid; c_nad uuid; c_uc uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'SO — Heavy Day (21 NADs)') then
    raise notice 'planning guide already exists, skipping: %', 'SO — Heavy Day (21 NADs)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('SO — Heavy Day (21 NADs)', 'a7347952-911a-4e77-94f5-30acd26cfd2e', '89ed75b7-6e66-4b03-b168-843921e4f4a3', 'Heavy NAD day', '{}',
       540, 1020, 60, 10, null)
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'NAD / Clinic', '#2563eb', '21 NADs / OEs', 0) returning id into c_nad;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Urgent Care', '#d97706', '4 VEs + 3 UCs', 10) returning id into c_uc;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 780, 60, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 'drop', 'Drop Off 9-11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 've', 'VE 9:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 600, 60, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 'uc', 'UC 11:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 've', 'VE 12:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 'uc', 'UC 2pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 'uc', 'UC 3pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 960, 60, 've', 'VE 4pm', 0);
  end if;
end $$;

do $$
declare gid uuid; c_nad uuid; c_uc uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'The Valley — Standard Day (14 NADs)') then
    raise notice 'planning guide already exists, skipping: %', 'The Valley — Standard Day (14 NADs)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('The Valley — Standard Day (14 NADs)', '4f74355f-d56c-44bb-93f0-99008eb97b14', '89ed75b7-6e66-4b03-b168-843921e4f4a3', 'Standard NAD day', '{}',
       540, 1020, 60, 20, null)
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'NAD / Clinic', '#2563eb', '14 NADs / OEs', 0) returning id into c_nad;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Urgent Care', '#d97706', '4 VEs + 4 UCs', 10) returning id into c_uc;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 780, 60, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 'drop', 'Drop Off 9-11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 've', 'VE 9:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 600, 60, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 'uc', 'UC 11:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 've', 'VE 12:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 'uc', 'UC 2pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 've', 'VE 2:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 'uc', 'UC 3pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 960, 60, 've', 'VE 4pm', 0);
  end if;
end $$;

do $$
declare gid uuid; c_nad uuid; c_uc uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'The Valley — Heavy Day (17 NADs)') then
    raise notice 'planning guide already exists, skipping: %', 'The Valley — Heavy Day (17 NADs)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('The Valley — Heavy Day (17 NADs)', '4f74355f-d56c-44bb-93f0-99008eb97b14', '89ed75b7-6e66-4b03-b168-843921e4f4a3', 'Heavy NAD day', '{}',
       540, 1020, 60, 30, null)
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'NAD / Clinic', '#2563eb', '17 NADs / OEs', 0) returning id into c_nad;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Urgent Care', '#d97706', '5 VEs + 3 UCs', 10) returning id into c_uc;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 780, 60, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 'drop', 'Drop Off 9-11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 've', 'VE 9:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 600, 60, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 'uc', 'UC 11:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 've', 'VE 12:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 'uc', 'UC 2pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 've', 'VE 2:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 'uc', 'UC 3pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 960, 60, 've', 'VE 4pm', 0);
  end if;
end $$;

do $$
declare gid uuid; c_nad uuid; c_uc uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'The Valley — Acupuncture Day (17 NADs)') then
    raise notice 'planning guide already exists, skipping: %', 'The Valley — Acupuncture Day (17 NADs)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('The Valley — Acupuncture Day (17 NADs)', '4f74355f-d56c-44bb-93f0-99008eb97b14', '89ed75b7-6e66-4b03-b168-843921e4f4a3', 'Acupuncture day', '{}',
       540, 1020, 60, 40, 'Mock-up acupuncture-day model.')
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'NAD / Clinic', '#2563eb', '17 NADs / OEs', 0) returning id into c_nad;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Urgent Care', '#d97706', '5 VEs + 3 Acu', 10) returning id into c_uc;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 780, 60, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'tech', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 'drop', 'Drop Off 9-11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 've', 'VE 9:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 600, 60, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 'acu', 'UC / Acupuncture', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 've', 'VE 12:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 'acu', 'UC / Acupuncture', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 've', 'VE 2:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 'acu', 'UC / Acupuncture', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 960, 60, 've', 'VE 4pm', 0);
  end if;
end $$;

do $$
declare gid uuid; c_nad uuid; c_uc uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'Venice — Mon/Wed (Vet Exam Heavy)') then
    raise notice 'planning guide already exists, skipping: %', 'Venice — Mon/Wed (Vet Exam Heavy)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('Venice — Mon/Wed (Vet Exam Heavy)', 'c6da9cc8-f00a-4d35-9b24-bb5f99ba80d0', '89ed75b7-6e66-4b03-b168-843921e4f4a3', 'Vet Exam heavy day', '{1,3}',
       540, 1020, 60, 50, null)
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'NAD / Clinic', '#2563eb', '13 NADs / OEs', 0) returning id into c_nad;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Vet Exam / Urgent Care', '#0d9488', '5 VEs / 6 UCs', 10) returning id into c_uc;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'block', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 780, 60, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'block', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 'drop', 'Drop Off 9-11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 've', 'VE 9:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 600, 60, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 'uc', 'UC 11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 've', 'VE 11:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 've', 'VE 12', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 'uc', 'UC 12:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 'uc', 'UC 2', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 've', 'VE 2:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 'uc', 'UC 3', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 've', 'VE 3:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 960, 60, 'uc', 'UC 4', 0);
  end if;
end $$;

do $$
declare gid uuid; c_nad uuid; c_uc uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'Venice — Tues/Thurs (Dental Heavy)') then
    raise notice 'planning guide already exists, skipping: %', 'Venice — Tues/Thurs (Dental Heavy)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('Venice — Tues/Thurs (Dental Heavy)', 'c6da9cc8-f00a-4d35-9b24-bb5f99ba80d0', '89ed75b7-6e66-4b03-b168-843921e4f4a3', 'Dental heavy day', '{2,4}',
       540, 1020, 60, 60, 'Dental-heavy clinic day; IM runs separately on Tues/Thurs.')
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'NAD / Clinic', '#2563eb', '21 NADs / OEs', 0) returning id into c_nad;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Urgent Care', '#d97706', '4 VEs / 4 UCs', 10) returning id into c_uc;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 540, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 600, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 660, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 720, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 780, 60, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 840, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 900, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'nad', null, 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_nad, 960, 60, 'tech', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 'drop', 'Drop Off', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 540, 60, 've', 'VE 9:30', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 600, 60, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 660, 60, 'uc', 'UC 11:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 720, 60, 've', 'VE 12:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 840, 60, 'uc', 'UC 2pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 900, 60, 'uc', 'UC 3pm', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_uc, 960, 60, 've', 'VE 4pm', 0);
  end if;
end $$;
