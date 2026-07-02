-- ============================================================================
-- Green Dog Ops — 0058 Exclude Service Fee from appointment count
-- ----------------------------------------------------------------------------
-- Add 'Service Fee' (sample shipping & handling, boarding, logistics) to the
-- non-appointment exclusions. Because the rule is exclusionary, a day is only
-- dropped when Service Fee is the ONLY invoiced item that day — any real visit
-- line keeps the appointment. Revenue is unaffected.
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
      -- membership billing, reminders, aftercare, fees, financial adjustments
      'Green Dog Pet Plus Wellness Plan',
      'Follow Up',
      'Cremation Services',
      'Service Fee',
      '*Discount/Credit/Deposit'
    );
$$;

-- Recompute every appointment-based roll-up with the new rule.
select greendogops.refresh_ezyvet_reporting();
