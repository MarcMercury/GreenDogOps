-- ============================================================================
-- Green Dog Ops — 0057 Expand non-appointment exclusions
-- ----------------------------------------------------------------------------
-- Extends greendogops.is_appt_line() with more line types that are NOT an
-- in-person DVM visit, so a client-day made up solely of these no longer counts
-- as an appointment (revenue is unaffected). Added groups:
--   * Parasite Control            — OTC preventatives (Simparica, Revolution…)
--   * Medications - Rx            — prescription refill / pharmacy pickup
--   * Controlled Substances - Rx  — prescription refill / pharmacy pickup
--   * Green Dog Pet Plus Wellness Plan — membership billing, no visit
--   * Follow Up                   — reminders/recommendations ("REMINDER: …")
--   * Cremation Services          — aftercare, no visit
--   * *Discount/Credit/Deposit    — financial adjustments
--
-- Kept as visits: *Services (exams, IV, nail trims), *Injectables (Cytopoint,
-- etc.), *Vaccination, all clinical specialties, Urgent Care, and lab work.
-- ============================================================================
set search_path = greendogops, public;

create or replace function greendogops.is_appt_line(p_name text, p_group text)
returns boolean
language sql
immutable
as $$
  select
    lower(coalesce(p_name, '')) not like '%deposit%'
    and lower(coalesce(p_name, '')) not like '%refund%'
    and coalesce(nullif(p_group, ''), '') not in (
      -- retail / OTC
      'Retail',
      'Consumables, Food, and Supplements',
      'Supplies',
      'Parasite Control',
      -- prescription refills / pharmacy pickups (no visit)
      'Medications - Rx',
      'Controlled Substances - Rx',
      -- membership billing, reminders, aftercare, financial adjustments
      'Green Dog Pet Plus Wellness Plan',
      'Follow Up',
      'Cremation Services',
      '*Discount/Credit/Deposit'
    );
$$;

-- Recompute every appointment-based roll-up with the new rule.
select greendogops.refresh_ezyvet_reporting();
