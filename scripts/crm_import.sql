-- crm_import.sql — copy data from shared public tables into greendogops CRM.
-- Idempotent via ON CONFLICT (source, external_id).
set search_path = greendogops, public;

-- ---- Referral clinics -----------------------------------------------------
insert into greendogops.crm_organization (
  org_type, name, subtype, status, contact_name, phone, email, website,
  instagram, address, area, services, tier, priority, total_referrals, revenue,
  relationship_score, is_active, last_visit_date, last_contact_date,
  last_referral_date, notes, source, external_id, created_at, updated_at)
select
  'referral_clinic',
  coalesce(nullif(trim(rp.name), ''), rp.hospital_name, 'Unknown'),
  rp.clinic_type,
  coalesce(rp.status, rp.relationship_status, case when rp.is_active then 'active' else 'inactive' end),
  coalesce(rp.contact_name, rp.contact_person, rp.best_contact_person, rp.key_decision_maker),
  coalesce(rp.phone, rp.key_decision_maker_phone),
  coalesce(rp.email, rp.key_decision_maker_email),
  rp.website,
  rp.instagram_handle,
  rp.address,
  rp.zone,
  coalesce(array_to_string(rp.services, ', '), array_to_string(rp.specialty_areas, ', ')),
  rp.tier,
  rp.priority,
  coalesce(rp.total_referrals, rp.total_referrals_all_time),
  coalesce(rp.revenue_ytd, rp.total_revenue_all_time, rp.referral_value_monthly),
  rp.relationship_score,
  coalesce(rp.is_active, true),
  rp.last_visit_date,
  rp.last_contact_date,
  rp.last_referral_date::date,
  rp.notes,
  'referral_partners', rp.id, coalesce(rp.created_at, now()), now()
from public.referral_partners rp
where rp.deleted_at is null
on conflict (source, external_id) where external_id is not null do nothing;

-- ---- Marketing / business partners ---------------------------------------
insert into greendogops.crm_organization (
  org_type, name, subtype, status, contact_name, phone, email, website,
  instagram, address, area, services, membership_level, annual_fee,
  account_number, relationship_score, is_active, last_visit_date,
  last_contact_date, notes, source, external_id, created_at, updated_at)
select
  'marketing_partner',
  coalesce(nullif(trim(mp.name), ''), 'Unknown'),
  coalesce(mp.partner_type::text, mp.category),
  mp.status::text,
  coalesce(mp.contact_name, mp.best_contact_person),
  mp.contact_phone,
  coalesce(mp.contact_email, mp.account_email),
  mp.website,
  mp.instagram_handle,
  mp.address,
  coalesce(mp.area, mp.proximity_to_location),
  mp.services_provided,
  mp.membership_level,
  mp.membership_fee,
  mp.account_number,
  mp.relationship_score,
  true,
  mp.last_visit_date,
  mp.last_contact_date,
  mp.notes,
  'marketing_partners', mp.id, coalesce(mp.created_at, now()), now()
from public.marketing_partners mp
on conflict (source, external_id) where external_id is not null do nothing;

-- ---- Facility resources ---------------------------------------------------
insert into greendogops.crm_organization (
  org_type, name, subtype, status, contact_name, phone, phone_alt, email,
  website, address, city, state, zip, area, is_preferred, internal_rating,
  is_active, notes, source, external_id, created_at, updated_at)
select
  'facility_resource',
  coalesce(nullif(trim(fr.name), ''), 'Unknown'),
  fr.resource_type,
  case when fr.is_active then 'active' else 'inactive' end,
  fr.company_name,
  fr.phone,
  fr.phone_alt,
  fr.email,
  fr.website,
  nullif(trim(concat_ws(', ', fr.address_line1, fr.address_line2)), ''),
  fr.city,
  fr.state,
  fr.zip,
  fr.service_area,
  coalesce(fr.is_preferred, false),
  fr.internal_rating,
  coalesce(fr.is_active, true),
  fr.notes,
  'facility_resources', fr.id, coalesce(fr.created_at, now()), now()
from public.facility_resources fr
on conflict (source, external_id) where external_id is not null do nothing;

-- ---- Med-ops vendors ------------------------------------------------------
insert into greendogops.crm_organization (
  org_type, name, subtype, status, contact_name, phone, email, website,
  address, products, account_number, account_rep, monthly_spend, spend_ytd,
  is_preferred, is_active, last_contact_date, notes, source, external_id,
  created_at, updated_at)
select
  'med_ops',
  coalesce(nullif(trim(mo.name), ''), 'Unknown'),
  mo.category,
  case when mo.is_active then 'active' else 'inactive' end,
  mo.contact_name,
  mo.contact_phone,
  mo.contact_email,
  mo.website,
  mo.address,
  mo.products,
  mo.account_number,
  mo.account_rep,
  mo.average_monthly_spend,
  mo.spend_ytd,
  coalesce(mo.is_preferred, false),
  coalesce(mo.is_active, true),
  mo.last_contact_date,
  coalesce(mo.notes, mo.description),
  'med_ops_partners', mo.id, coalesce(mo.created_at, now()), now()
from public.med_ops_partners mo
on conflict (source, external_id) where external_id is not null do nothing;

-- ---- Students -------------------------------------------------------------
insert into greendogops.crm_contact (
  contact_type, first_name, last_name, full_name, email, phone, status,
  organization, program_type, program_name, cohort, school, location, mentor,
  coordinator, start_date, end_date, hours_completed, hours_required,
  eligible_for_employment, notes, source, external_id, created_at, updated_at)
select
  'student',
  sp.first_name,
  sp.last_name,
  sp.display_name,
  sp.email,
  sp.phone_mobile,
  sp.enrollment_status::text,
  sp.school_of_origin,
  sp.program_type::text,
  sp.program_name,
  sp.cohort_identifier,
  coalesce(sp.school_of_origin, sp.school_program),
  sp.location_name,
  sp.mentor_name,
  sp.coordinator_name,
  sp.start_date,
  sp.end_date,
  sp.hours_completed,
  sp.hours_required,
  sp.eligible_for_employment,
  sp.overall_performance_rating,
  'student_program_view', sp.person_id, coalesce(sp.created_at, now()), now()
from public.student_program_view sp
on conflict (source, external_id) where external_id is not null do nothing;

select
  (select count(*) from greendogops.crm_organization) as organizations,
  (select count(*) from greendogops.crm_contact)      as contacts;
