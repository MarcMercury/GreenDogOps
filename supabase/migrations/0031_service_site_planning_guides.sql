-- ============================================================================
-- Green Dog Ops — 0031 Service-site planning guides (IM, Exotics, 2-DVM)
-- ----------------------------------------------------------------------------
-- Internal Medicine (double + single day), Exotics, and the Venice 2-DVM
-- vet-exam model, derived from the GDD planning guides workbook.
-- Idempotent: skips any guide whose name already exists.
-- ============================================================================
set search_path = greendogops, public;

do $$
declare gid uuid; c_im uuid; c_den uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'Venice IM — Double Day (IM + Dental)') then
    raise notice 'skip %', 'Venice IM — Double Day (IM + Dental)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, service_label, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('Venice IM — Double Day (IM + Dental)', 'c6da9cc8-f00a-4d35-9b24-bb5f99ba80d0', 'ad477358-8eb6-43e7-9562-947bd2240a3d', 'Internal Medicine', 'Double IM / Dental day', '{}',
       540, 1020, 15, 100, 'Internal Medicine + Dental clinic run together.')
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Internal Med', '#9333ea', '2-3 IM consults / US', 0) returning id into c_im;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Dental Clinic', '#db2777', 'Dental + NAD/OE/VE', 10) returning id into c_den;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 540, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 555, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 570, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 585, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 600, 45, 'im', 'New IM Consult / US', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 645, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 660, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 675, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 690, 45, 'im', 'New IM Consult / US', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 735, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 750, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 765, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 780, 15, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 840, 45, 'im', 'New IM Consult / US', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 885, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 900, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 915, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 930, 45, 'im', 'New IM Consult / US', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 975, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 990, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 540, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 555, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 570, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 585, 15, 'tech', 'IM Tech', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 600, 15, 'dental', 'Dental Only', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 615, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 630, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 645, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 660, 15, 'tech', 'IM Tech', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 675, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 690, 15, 'dental', 'Dental Only', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 705, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 720, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 735, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 750, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 765, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 780, 15, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 840, 15, 'dental', 'Dental Only', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 855, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 870, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 885, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 900, 15, 'tech', 'IM Tech', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 915, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 930, 15, 'dental', 'Dental Only', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 945, 15, 'tech', 'IM Tech', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 960, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 975, 15, 'nad', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_den, 990, 15, 'nad', null, 0);
  end if;
end $$;

do $$
declare gid uuid; c_im uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'Venice IM — Single IM Day') then
    raise notice 'skip %', 'Venice IM — Single IM Day';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, service_label, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('Venice IM — Single IM Day', 'c6da9cc8-f00a-4d35-9b24-bb5f99ba80d0', 'ad477358-8eb6-43e7-9562-947bd2240a3d', 'Internal Medicine', 'Single IM day (Tue)', '{2}',
       540, 1020, 15, 110, null)
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Internal Med', '#9333ea', 'IM consults + rechecks', 0) returning id into c_im;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 540, 15, 'drop', 'Procedure Drop Off', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 555, 15, 'drop', 'Procedure Drop Off', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 570, 45, 'im', 'New IM Consult / US', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 615, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 630, 45, 'im', 'New IM Consult / US', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 660, 15, 'tech', 'IM Tech Appt', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 675, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 690, 45, 'im', 'New IM Consult / US', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 735, 15, 'block', null, 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 750, 30, 'im', 'IM Recheck / Urgent', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 780, 15, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 810, 15, 'block', 'Blocked off — IM', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 870, 30, 'im', 'IM Recheck / Urgent', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 900, 30, 'im', 'IM Recheck / Urgent', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 915, 15, 'tech', 'IM Tech Appt', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 930, 30, 'im', 'IM Recheck / Urgent', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 960, 30, 'im', 'IM Recheck / Urgent', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_im, 990, 30, 'im', 'IM Recheck / Urgent', 0);
  end if;
end $$;

do $$
declare gid uuid; c_ex uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'THE VALLEY - Exotics') then
    raise notice 'skip %', 'THE VALLEY - Exotics';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, service_label, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('THE VALLEY - Exotics', '4f74355f-d56c-44bb-93f0-99008eb97b14', 'ab45bd0e-ff3f-4416-8b47-a6e8c149df33', 'Exotics', 'Standard exotics day', '{}',
       540, 1050, 30, 120, 'Exotics service site (own planning guide).')
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Exotics', '#16a34a', 'Sick/Referral, Recheck, Wellness, Grooming', 0) returning id into c_ex;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 540, 60, 'ex_sick', 'Sick / Referral', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 600, 60, 'ex_sick', 'Sick / Referral', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 660, 60, 'ex_sick', 'Sick / Referral', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 720, 30, 'ex_recheck', 'Recheck', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 750, 30, 'ex_recheck', 'Recheck', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 780, 30, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 840, 30, 'ex_recheck', 'Recheck', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 870, 30, 'ex_wellness', 'Wellness', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 900, 20, 'ex_wellness', 'Wellness', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 900, 20, 'ex_wellness', 'Wellness', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 900, 20, 'ex_wellness', 'Wellness', 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 900, 30, 'block', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 960, 20, 'ex_groom', 'Tech Grooming', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 960, 20, 'ex_groom', 'Tech Grooming', 1);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 960, 20, 'ex_groom', 'Tech Grooming', 2);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 960, 30, 'block', null, 3);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ex, 1020, 20, 'ex_groom', 'Tech Grooming', 0);
  end if;
end $$;

do $$
declare gid uuid; c_ve uuid;
begin
  if exists (select 1 from greendogops.planning_guide where name = 'Venice — 2-DVM Day (Vet Exam)') then
    raise notice 'skip %', 'Venice — 2-DVM Day (Vet Exam)';
  else
    insert into greendogops.planning_guide
      (name, location_id, department_id, service_label, day_model, weekdays,
       start_minute, end_minute, slot_minutes, sort_order, notes)
    values ('Venice — 2-DVM Day (Vet Exam)', 'c6da9cc8-f00a-4d35-9b24-bb5f99ba80d0', '89ed75b7-6e66-4b03-b168-843921e4f4a3', null, '2-DVM vet-exam model', '{}',
       540, 1020, 30, 130, '1 DVM + 1 DA vet-exam clinic model.')
    returning id into gid;
    insert into greendogops.planning_guide_column (guide_id, name, color, capacity_note, sort_order)
    values (gid, 'Vet Exam (2-DVM)', '#0d9488', '11 Vet Exams, 1 UC', 0) returning id into c_ve;
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 540, 30, 'drop', 'Drop Off 9-11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 570, 30, 've', 'VE 9:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 600, 30, 've', 'VE 10', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 630, 30, 've', 'VE 10:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 660, 30, 've', 'VE 11', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 690, 30, 've', 'VE 11:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 720, 30, 've', 'VE 12', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 750, 30, 've', 'VE 12:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 780, 30, 'lunch', 'Lunch', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 840, 30, 've', 'VE 2', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 870, 30, 've', 'VE 2:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 900, 30, 've', 'VE 3', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 930, 30, 've', 'VE 3:30', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 960, 30, 've', 'VE 4', 0);
    insert into greendogops.planning_guide_slot (guide_id, column_id, start_minute, duration_minutes, type_code, label, sort_order)
    values (gid, c_ve, 990, 30, 'uc', 'UC 4:30', 0);
  end if;
end $$;
