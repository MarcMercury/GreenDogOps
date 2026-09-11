-- ============================================================================
-- Green Dog Ops — 0183 Smart Report: explain the future-dated appointment columns
-- ----------------------------------------------------------------------------
-- A user asked for next week's appointment totals per type and location and got
-- zeros for everything, even though 349 appointments are on the book.
--
-- Nothing is broken. appointment_review_by_type() is a booked-vs-RENDERED
-- comparison, so `scheduled`, `rendered` and `not_rendered` only count days that
-- have already been re-scanned after the fact. For a FUTURE day nothing has been
-- re-scanned yet, so the whole booked count sits in `pending` — which the model
-- ignored because the column it picked was literally named "scheduled".
--
-- The function comments are fed to the model by smart_functions() (0180), so
-- spelling the rule out here is what stops it happening again. Behaviour is
-- unchanged: the Reporting page reads these same columns.
-- ============================================================================
set search_path = greendogops, public;

comment on function greendogops.appointment_review_by_type(date, date) is
  'Booked vs rendered appointments grouped by ezyVet appointment TYPE per location: scheduled, rendered, added, not_rendered, pending. ⚠️ This is a LOOK-BACK comparison: scheduled/rendered/not_rendered only count days that have already been re-scanned after they happened. For TODAY or any FUTURE date nothing has been re-scanned, so those three are 0 and the entire booked count is in PENDING. For "what is booked next week" either sum pending here, or use appointment_review() and sum expected_count.';

comment on function greendogops.appointment_review(date, date) is
  'Booked vs rendered appointments per location/department/day. Returns location_name, department_name, appt_date, expected_count (booked) and rendered_count. THE canonical source for "how many appointments are booked on <day>" — it already picks the right agenda snapshot, and expected_count is correct for FUTURE dates (rendered_count is simply null until the day is re-scanned).';
