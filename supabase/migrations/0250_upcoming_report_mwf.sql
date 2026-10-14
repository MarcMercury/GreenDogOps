-- ============================================================================
-- Green Dog Ops — 0249 Upcoming-appointments report moves to Mon/Wed/Fri 9 AM PT
-- ----------------------------------------------------------------------------
-- Owner request 2026-10-14: post the upcoming-appointments Slack report Monday,
-- Wednesday and Friday at 9 AM Pacific, after the morning ezyVet uploads,
-- instead of Tuesday/Thursday.
--
-- vercel.json now fires at 16:00 and 17:00 UTC (DST-safe pair) and the route
-- only posts on the run that lands at 9 AM Pacific. The longest gap between
-- posts is now Fri → Mon (72 h), so the staleness window drops from 122 h to
-- 74 h. Data-only: no schema change, so the baseline is unaffected.
-- ============================================================================

set search_path = greendogops, public;

begin;

update greendogops.agent
   set description   = 'Posts next week''s booked vs offered appointments to Slack (Mon/Wed/Fri, 9 AM Pacific).',
       schedule_cron = '0 16,17 * * 1,3,5',
       timezone      = 'UTC',
       config        = config || jsonb_build_object('stale_after_minutes', 4440)
 where key = 'reporting_slack_upcoming';

commit;
