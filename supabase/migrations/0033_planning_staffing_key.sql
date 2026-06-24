-- ============================================================================
-- Green Dog Ops — 0033 Planning-guide staffing key
-- ----------------------------------------------------------------------------
-- Reframes the relationship between the Schedule and the Planning Guides.
--
-- The Schedule is authored FIRST; the planning guide that applies to a given
-- day then FOLLOWS from how many doctors are staffed. A guide is therefore a
-- reusable template keyed by a STAFFING SIGNATURE rather than by a calendar
-- weekday: (location + department + number of DVMs the day is designed for).
--
-- `dvm_count` is that signature's primary lever. The resolver (TS) counts the
-- DVMs actually scheduled in a (location, department, day) and picks the guide
-- whose dvm_count matches, falling back to the closest lower count and using
-- `weekdays` only to break ties between same-count variants.
--
-- The initial dvm_count for the seeded guides is derived by reason from each
-- guide's name / day-model and its exam-track composition:
--   * "Standard" NAD days  -> 1 DVM
--   * "Heavy" / "2-DVM" / "Double" days, and the acupuncture day (adds a
--     second provider) -> 2 DVMs
--   * Weekday-specific single-doctor Venice models (Mon/Wed, Tue/Thu) -> 1 DVM
--   * Single specialty days (Single IM, Exotics) -> 1 DVM
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- Column: dvm_count — the number of DVMs this guide's capacity is designed for.
-- NULL = unspecified (guide is selected manually, not by staffing).
-- ---------------------------------------------------------------------------
alter table greendogops.planning_guide
  add column if not exists dvm_count smallint;

comment on column greendogops.planning_guide.dvm_count is
  'Number of DVMs this guide''s appointment capacity is designed for. The '
  'schedule resolver matches the DVMs actually staffed in a (location, '
  'department, day) against this value. NULL = manual selection only.';

-- ---------------------------------------------------------------------------
-- Backfill the seeded guides from their staffing signature (reasoned above).
-- Idempotent: only sets rows whose dvm_count is still NULL.
--
-- Logic, in priority order:
--   1. Names that explicitly call out two doctors ("2-DVM", "Double") -> 2.
--   2. Weekday-specific guides (non-empty `weekdays`, e.g. Venice Mon/Wed,
--      Tue/Thu, Single IM Tue) are single-doctor day-of-week models -> 1.
--      ("Heavy" in those names denotes appointment-mix emphasis, not doctors.)
--   3. Otherwise, generic guides flagged "Heavy" or "Acupuncture" (which adds a
--      second provider) -> 2.
--   4. Everything else -> 1.
-- ---------------------------------------------------------------------------
update greendogops.planning_guide
set dvm_count = case
    when name ilike '%2-DVM%' or name ilike '%Double%'           then 2
    when array_length(weekdays, 1) is not null                   then 1
    when name ilike '%Heavy%' or name ilike '%Acupuncture%'      then 2
    else 1
  end
where dvm_count is null;
