-- ============================================================================
-- Green Dog Ops — 0243 Time-clock attendance settings (go-live checklist item 16)
-- ----------------------------------------------------------------------------
-- Shifts are graded from punches at read time (src/lib/timeclock/attendance.ts):
-- on time / late / very late, left early, completed, missed, incomplete. The
-- Scheduling ▸ Time & Attendance dashboard always shows the grades.
--
-- timeclock.attendance_from (blank = off): from this date, the grades also
-- become the official attendance — reliability scores and grid badges use them
-- for unmarked shifts, and missed / late alerts go out. A manager's manual mark
-- always wins. Off until the shadow run has real punch adoption, so weeks
-- without punches are never graded "missed".
--
-- Thresholds are minutes. Data only; no schema change.
-- ============================================================================

set search_path = greendogops, public;

begin;

insert into greendogops.app_setting (key, value, category, label, description) values
  ('timeclock.attendance_from', '""'::jsonb, 'timeclock',
   'Use time-clock attendance from (YYYY-MM-DD)',
   'Blank = off. From this date, time-clock grades count for reliability and the grid, and missed / late alerts are sent. A manager''s manual attendance mark always wins.'),
  ('timeclock.late_grace_minutes', '5'::jsonb, 'timeclock',
   'Late after (minutes past shift start)',
   'A clock-in more than this many minutes after the shift starts is late.'),
  ('timeclock.very_late_minutes', '15'::jsonb, 'timeclock',
   'Very late after (minutes past shift start)',
   'A clock-in more than this many minutes after the shift starts is very late.'),
  ('timeclock.missed_after_minutes', '60'::jsonb, 'timeclock',
   'Missed after (minutes past shift start)',
   'No clock-in this long after the shift starts marks the shift missed.'),
  ('timeclock.left_early_minutes', '10'::jsonb, 'timeclock',
   'Left early when out more than (minutes before shift end)',
   'A clock-out more than this many minutes before the shift ends is left early.')
on conflict (key) do nothing;

commit;
