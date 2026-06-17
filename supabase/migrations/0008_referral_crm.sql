-- =====================================================
-- Migration 0008: Referral CRM (Medical Partnerships)
-- =====================================================
-- Ports the EmployeeGMGDD "Medical Partnerships CRM" feature into the
-- greendogops schema as a full-fidelity, self-contained module.
--
-- Mirrors the source public.* tables (structure + data) into greendogops:
--   referral_partners            - core partner/clinic records
--   referral_revenue_line_items  - per-referral revenue ledger (EzyVet)
--   referral_sync_history        - CSV/XLS upload log
--   clinic_visits                - visit log (Activity tab + Quick Visit)
--   partner_contacts             - multiple contacts per partner
--   partner_notes                - pinnable, categorized notes
--
-- Plus the ledger/metric SQL functions that power the EzyVet upload,
-- "Recalculate Metrics", and per-upload "Undo":
--   recompute_referral_partner_totals()
--   recalculate_partner_metrics()
--   undo_referral_upload(uuid)
--
-- LIKE ... copies column types, defaults, NOT NULL + CHECK constraints and
-- indexes, but NOT foreign keys (intentional — the source FKs point at
-- public.profiles / auth.users / marketing_partners which we don't mirror).
-- =====================================================

-- ---------------------------------------------------------------
-- 1. Mirror table structures
-- ---------------------------------------------------------------
create table if not exists greendogops.referral_partners
  (like public.referral_partners including defaults including constraints including indexes);

create table if not exists greendogops.referral_revenue_line_items
  (like public.referral_revenue_line_items including defaults including constraints including indexes);

create table if not exists greendogops.referral_sync_history
  (like public.referral_sync_history including defaults including constraints including indexes);

create table if not exists greendogops.clinic_visits
  (like public.clinic_visits including defaults including constraints including indexes);

create table if not exists greendogops.partner_contacts
  (like public.partner_contacts including defaults including constraints including indexes);

create table if not exists greendogops.partner_notes
  (like public.partner_notes including defaults including constraints including indexes);

-- ---------------------------------------------------------------
-- 2. Copy data (idempotent: skip rows already present by id)
-- ---------------------------------------------------------------
insert into greendogops.referral_partners
  select * from public.referral_partners s
  where not exists (select 1 from greendogops.referral_partners g where g.id = s.id);

insert into greendogops.referral_sync_history
  select * from public.referral_sync_history s
  where not exists (select 1 from greendogops.referral_sync_history g where g.id = s.id);

insert into greendogops.referral_revenue_line_items
  select * from public.referral_revenue_line_items s
  where not exists (select 1 from greendogops.referral_revenue_line_items g where g.id = s.id);

insert into greendogops.clinic_visits
  select * from public.clinic_visits s
  where not exists (select 1 from greendogops.clinic_visits g where g.id = s.id);

insert into greendogops.partner_contacts
  select * from public.partner_contacts s
  where not exists (select 1 from greendogops.partner_contacts g where g.id = s.id);

insert into greendogops.partner_notes
  select * from public.partner_notes s
  where not exists (select 1 from greendogops.partner_notes g where g.id = s.id);

-- ---------------------------------------------------------------
-- 3. Grants (greendogops uses app-layer gating, RLS disabled — same as
--    crm_organization etc. in 0003)
-- ---------------------------------------------------------------
grant select, insert, update, delete on greendogops.referral_partners            to authenticated, service_role;
grant select, insert, update, delete on greendogops.referral_revenue_line_items  to authenticated, service_role;
grant select, insert, update, delete on greendogops.referral_sync_history        to authenticated, service_role;
grant select, insert, update, delete on greendogops.clinic_visits                to authenticated, service_role;
grant select, insert, update, delete on greendogops.partner_contacts             to authenticated, service_role;
grant select, insert, update, delete on greendogops.partner_notes                to authenticated, service_role;

-- ---------------------------------------------------------------
-- 4. Re-derive partner totals from the line-item ledger
--    (port of public.recompute_referral_partner_totals)
-- ---------------------------------------------------------------
create or replace function greendogops.recompute_referral_partner_totals()
returns void
language plpgsql
security definer
set search_path = greendogops
as $$
begin
  with agg as (
    select
      partner_id,
      count(*)::int                          as visit_count,
      round(sum(amount)::numeric, 2)         as revenue_sum,
      max(nullif(transaction_date,'')::date) as last_date
    from greendogops.referral_revenue_line_items
    where partner_id is not null
    group by partner_id
  )
  update greendogops.referral_partners p
  set
    total_revenue_all_time   = coalesce(a.revenue_sum, 0),
    total_referrals_all_time = coalesce(a.visit_count, 0),
    last_referral_date       = greatest(
      coalesce(p.last_referral_date::date, a.last_date),
      a.last_date
    )
  from agg a
  where p.id = a.partner_id;

  -- Zero out partners with no ledger rows so stale data clears.
  update greendogops.referral_partners p
  set
    total_revenue_all_time   = 0,
    total_referrals_all_time = 0
  where not exists (
    select 1 from greendogops.referral_revenue_line_items li
    where li.partner_id = p.id
  )
  and (p.total_revenue_all_time <> 0 or p.total_referrals_all_time <> 0);
end;
$$;

grant execute on function greendogops.recompute_referral_partner_totals() to authenticated, service_role;

-- ---------------------------------------------------------------
-- 5. Recompute totals, then redistribute tier / priority / visit-tier /
--    relationship health for every partner.
--    (port of public.recalculate_partner_metrics)
-- ---------------------------------------------------------------
create or replace function greendogops.recalculate_partner_metrics()
returns setof greendogops.referral_partners
language plpgsql
security definer
set search_path = greendogops
as $$
begin
  -- Step 0: re-derive ledger totals first.
  perform greendogops.recompute_referral_partner_totals();

  -- Step 1: Tier (revenue quintiles)
  with tier_calc as (
    select id, ntile(5) over (order by coalesce(total_revenue_all_time, 0) desc) as tier_bucket
    from greendogops.referral_partners
  )
  update greendogops.referral_partners rp
  set tier = case tc.tier_bucket
    when 1 then 'Platinum' when 2 then 'Gold' when 3 then 'Silver'
    when 4 then 'Bronze'   when 5 then 'Coal' end
  from tier_calc tc
  where rp.id = tc.id;

  -- Step 2: Priority (referral-count quartiles)
  with priority_calc as (
    select id, ntile(4) over (order by coalesce(total_referrals_all_time, 0) desc) as priority_bucket
    from greendogops.referral_partners
  )
  update greendogops.referral_partners rp
  set priority = case pc.priority_bucket
    when 1 then 'Very High' when 2 then 'High' when 3 then 'Medium' when 4 then 'Low' end
  from priority_calc pc
  where rp.id = pc.id;

  -- Step 3: Visit tier and expected cadence
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

-- ---------------------------------------------------------------
-- 6. Undo a single upload — selective rollback
--    (port of public.undo_referral_upload)
-- ---------------------------------------------------------------
create or replace function greendogops.undo_referral_upload(p_upload_id uuid)
returns table (rows_deleted integer, upload_id uuid)
language plpgsql
security definer
set search_path = greendogops
as $$
declare
  v_deleted integer;
begin
  if p_upload_id is null then
    raise exception 'upload_id is required';
  end if;

  delete from greendogops.referral_revenue_line_items
  where upload_id = p_upload_id;
  get diagnostics v_deleted = row_count;

  update greendogops.referral_sync_history
  set sync_details = coalesce(sync_details, '{}'::jsonb)
                     || jsonb_build_object('undone_at', now(), 'rows_removed', v_deleted)
  where id = p_upload_id;

  perform greendogops.recompute_referral_partner_totals();

  return query select v_deleted, p_upload_id;
end;
$$;

grant execute on function greendogops.undo_referral_upload(uuid) to authenticated, service_role;
