-- =====================================================
-- Referral CRM: switch tier & priority from comparative quantiles
-- (ntile) to FIXED absolute thresholds.
--
-- Tier      → lifetime revenue (total_revenue_all_time)
--   Platinum  >= $30,000
--   Gold      $15,000 – $29,999
--   Silver    $5,000  – $14,999
--   Bronze    $500    – $4,999
--   Coal      < $500
--
-- Priority  → lifetime referrals (total_referrals_all_time)
--   Very High >= 20
--   High      10 – 19
--   Medium    3  – 9
--   Low       < 3
--
-- Only Step 1 (tier) and Step 2 (priority) change vs. 0008_referral_crm.sql;
-- all other steps (visit tier, overdue, relationship health) are preserved.
-- =====================================================

create or replace function greendogops.recalculate_partner_metrics()
returns setof greendogops.referral_partners
language plpgsql
security definer
set search_path = greendogops
as $$
begin
  -- Step 0: re-derive ledger totals first.
  perform greendogops.recompute_referral_partner_totals();

  -- Step 1: Tier (FIXED revenue thresholds)
  update greendogops.referral_partners
  set tier = case
    when coalesce(total_revenue_all_time, 0) >= 30000 then 'Platinum'
    when coalesce(total_revenue_all_time, 0) >= 15000 then 'Gold'
    when coalesce(total_revenue_all_time, 0) >= 5000  then 'Silver'
    when coalesce(total_revenue_all_time, 0) >= 500   then 'Bronze'
    else 'Coal'
  end;

  -- Step 2: Priority (FIXED referral-count thresholds)
  update greendogops.referral_partners
  set priority = case
    when coalesce(total_referrals_all_time, 0) >= 20 then 'Very High'
    when coalesce(total_referrals_all_time, 0) >= 10 then 'High'
    when coalesce(total_referrals_all_time, 0) >= 3  then 'Medium'
    else 'Low'
  end;

  -- Step 3: Visit tier and expected cadence (unchanged — blended quantile)
  with visit_tier_calc as (
    select id,
      ntile(3) over (
        order by (coalesce(total_revenue_all_time, 0) + coalesce(total_referrals_all_time, 0) * 100) desc
      ) as visit_bucket
    from greendogops.referral_partners
  )
  update greendogops.referral_partners rp
  set
    visit_tier = case vtc.visit_bucket when 1 then 'High' when 2 then 'Medium' when 3 then 'Low' end,
    expected_visit_frequency_days = case vtc.visit_bucket when 1 then 60 when 2 then 120 when 3 then 180 end
  from visit_tier_calc vtc
  where rp.id = vtc.id;

  -- Step 4: Days since last visit + overdue
  update greendogops.referral_partners
  set
    days_since_last_visit = case
      when last_visit_date is not null then extract(day from (now() - last_visit_date::timestamp))::integer
      else null end,
    visit_overdue = case
      when last_visit_date is null then true
      when extract(day from (now() - last_visit_date::timestamp)) > coalesce(expected_visit_frequency_days, 120) then true
      else false end;

  -- Step 5: Relationship health & status
  update greendogops.referral_partners
  set
    relationship_health = (
      case tier
        when 'Platinum' then 40 when 'Gold' then 32 when 'Silver' then 24
        when 'Bronze' then 16 when 'Coal' then 8 else 0 end
      +
      case priority
        when 'Very High' then 30 when 'High' then 22 when 'Medium' then 15 when 'Low' then 8 else 0 end
      +
      case
        when last_visit_date is null then 0
        when days_since_last_visit <= coalesce(expected_visit_frequency_days, 120) * 0.5 then 30
        when days_since_last_visit <= coalesce(expected_visit_frequency_days, 120) then 20
        when days_since_last_visit <= coalesce(expected_visit_frequency_days, 120) * 1.5 then 10
        else 0 end
    ),
    relationship_status = case
      when relationship_health >= 80 then 'Excellent'
      when relationship_health >= 60 then 'Good'
      when relationship_health >= 40 then 'Fair'
      when relationship_health >= 20 then 'Needs Attention'
      else 'At Risk' end,
    needs_followup = case
      when visit_overdue = true then true
      when relationship_health < 40 then true
      else needs_followup end;

  return query select * from greendogops.referral_partners order by name;
end;
$$;

grant execute on function greendogops.recalculate_partner_metrics() to authenticated, service_role;

-- Apply immediately so existing rows reflect the new fixed thresholds.
select greendogops.recalculate_partner_metrics();
