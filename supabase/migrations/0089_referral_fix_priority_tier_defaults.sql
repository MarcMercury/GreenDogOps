-- =====================================================
-- Migration 0089: Fix invalid referral_partners default values
-- =====================================================
-- The `priority` and `tier` columns (inherited from public.referral_partners
-- via LIKE in 0008) carry lowercase defaults ('medium' / 'bronze') that
-- violate their own CHECK constraints, which only permit title-cased values:
--   priority  → 'Very High' | 'High' | 'Medium' | 'Low' | NULL
--   tier      → 'Platinum' | 'Gold' | 'Silver' | 'Bronze' | 'Coal' (NOT NULL)
--
-- Any INSERT that omitted these columns (e.g. the "+ Add to CRM" quick-add on
-- the Upload tab) fell back to the bad defaults and failed with:
--   new row ... violates check constraint "referral_partners_priority_check"
--
-- Repoint the defaults at valid values (priority defaults to NULL since it is
-- nullable and recalculate_partner_metrics() derives it; tier defaults to the
-- lowest tier 'Coal' since it is NOT NULL), then normalise any existing rows
-- that still hold the invalid lowercase values.
-- =====================================================

alter table greendogops.referral_partners
  alter column priority drop default;

alter table greendogops.referral_partners
  alter column tier set default 'Coal';

-- Normalise any rows created with the old invalid defaults.
update greendogops.referral_partners
   set priority = case lower(priority)
     when 'very high' then 'Very High'
     when 'high'      then 'High'
     when 'medium'    then 'Medium'
     when 'low'       then 'Low'
     else null
   end
 where priority is not null
   and priority not in ('Very High', 'High', 'Medium', 'Low');

update greendogops.referral_partners
   set tier = case lower(tier)
     when 'platinum' then 'Platinum'
     when 'gold'     then 'Gold'
     when 'silver'   then 'Silver'
     when 'bronze'   then 'Bronze'
     else 'Coal'
   end
 where tier is null
    or tier not in ('Platinum', 'Gold', 'Silver', 'Bronze', 'Coal');
