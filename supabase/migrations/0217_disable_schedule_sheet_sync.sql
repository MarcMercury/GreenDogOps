-- ============================================================================
-- 0217 — Turn off the staff-schedule sheet scrape and blank the grid from
-- October 2026 on
--
-- The nightly pull of "GDD Staff Schedule 2026"
-- (18DvLbxmzT-mmyaCRUW2xbzRxG4-HNPJS8rbUHZdNXdU) has been producing an
-- inaccurate grid: the sheet's shift times and role labels don't line up with
-- the grid's template lines, so placements land on the wrong rows. Per ops:
--
--   1. Disable that one sync source. The sheet_daily_sync agent keeps running
--      for the HR roster and the student grid; it simply skips this workbook
--      (runSheetSync only loads enabled sources). Re-enable any time from
--      Admin ▸ Agents or by flipping `enabled` back on.
--   2. Clear every grid assignment from 2026-10-01 onward — sheet-imported AND
--      hand-entered — so the weeks present as blank schedules to rebuild.
--      Week shells, template lines, closures and statuses are left alone
--      (every affected week is still a draft). PTO lives in person_time_off
--      and is NOT touched.
--   3. Drop the ad-hoc lines the importer invented (is_adhoc) in those weeks,
--      returning each week's rows to what the Dept/Shift Template defines.
--      The straddling week of 2026-09-27 keeps its lines so its September
--      days survive; only its Oct 1–3 assignments are cleared by step 2.
--   4. Resolve the open staff_schedule review-queue issues: with the feed off
--      nothing will ever re-check them.
-- ============================================================================
set search_path = greendogops, public;

-- 1. Stop the nightly scrape of this workbook.
update greendogops.sheet_sync_source
   set enabled = false,
       last_status = 'skipped',
       last_error  = null
 where key = 'staff_schedule';

-- 3 first (lines cascade to their assignments anyway): remove importer-created
-- ad-hoc lines from the October-onward weeks.
delete from greendogops.sched_week_line l
 using greendogops.sched_week w
 where w.id = l.week_id
   and w.is_template = false
   and w.week_start >= '2026-10-04'
   and l.is_adhoc;

-- 2. Blank every assignment worked on/after Oct 1, 2026 (also clears the
-- Oct 1–3 tail of the week that starts 2026-09-27).
delete from greendogops.sched_assignment a
 using greendogops.sched_week w
 where w.id = a.week_id
   and w.is_template = false
   and a.work_date >= '2026-10-01';

-- 4. Close out the review queue for this source; `ignored` rows stay ignored.
update greendogops.sheet_sync_issue
   set status = 'resolved',
       resolved_at = now(),
       resolved_by_email = 'system:0217_disable_schedule_sheet_sync'
 where source_key = 'staff_schedule'
   and status = 'open';
