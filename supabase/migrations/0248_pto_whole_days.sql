-- ============================================================================
-- Green Dog Ops — 0248 PTO is whole 8-hour days only
-- ----------------------------------------------------------------------------
-- Owner decision 2026-10-14: sick time and planned time off are both taken in
-- full 8-hour days — no partial days, no exceptions. This replaces the 0246
-- note that "a partial sick day is a fraction (2 h = 0.25)".
--
-- The app already only writes whole days (src/lib/pto/balance.ts); these
-- checks stop any other writer from reintroducing fractions. Verified before
-- writing: 0 of 624 person_time_off rows and 0 pto_policy_allotment values
-- were fractional in production.
--
-- person_employment.pto_used / pto_available are deliberately NOT constrained:
-- a few legacy rows hold non-day values from the old sheet import, and a CHECK
-- would block every save of those profiles. The HR form rejects fractional
-- edits instead.
-- ============================================================================

set search_path = greendogops, public;

begin;

alter table greendogops.person_time_off
  add constraint person_time_off_pto_days_whole
    check (pto_days is null or pto_days = trunc(pto_days)),
  add constraint person_time_off_pto_days_deducted_whole
    check (pto_days_deducted = trunc(pto_days_deducted));

alter table greendogops.person_employment
  add constraint person_employment_pto_policy_allotment_whole
    check (pto_policy_allotment is null or pto_policy_allotment = trunc(pto_policy_allotment));

comment on column greendogops.person_time_off.pto_days is
  'PTO days this request uses (0246, 0248). Whole 8-hour days only, sick time included. NULL = every calendar day in the range. 0 = approve without deducting.';
comment on column greendogops.person_time_off.pto_days_deducted is
  'Whole days this request currently holds against person_employment.pto_available (0246, 0248). Set only by the person_time_off_balance trigger.';

commit;
