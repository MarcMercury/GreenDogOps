-- ============================================================================
-- Green Dog Ops — 0202 Smart Report glossary: service lines / departments
-- ----------------------------------------------------------------------------
-- "What was our revenue in Advanced Procedures on 9/17 by clinic" was answered
-- with product_group = '*Surgical Procedure' (Venice $480.00) instead of
-- '*AP Dental/Endodontics' (Venice $12,164.30) — the model matched the word
-- "procedures" in the group NAME. AP is the practice's largest service line, so
-- this is not a rounding error: it under-reported the day by ~25x.
--
-- The department names the team uses share no words with the stored
-- product_group values, so the mapping has to be taught. Glossary entries fire
-- on the phrasing people actually type ("AP", "APs", "dentals", "endo"), which
-- DOMAIN_NOTES alone cannot do.
-- ============================================================================
set search_path = greendogops, public;

insert into greendogops.smart_glossary (term, aliases, definition, sql_hint)
values
  ('advanced procedures',
   array['advanced procedure','ap','aps','ap department','ap day','ap revenue','dentals','dentistry','dental department','endo','endodontics','oral surgery'],
   'The AP (Advanced Procedures) department — dentistry, extractions, dental radiographs, root canals and oral surgery. It bills under product_group = ''*AP Dental/Endodontics'' and is the practice''s largest service line (~$4.3M in 2026). It is NOT ''*Surgical Procedure''; using that group under-reports AP by an order of magnitude. Appointment types ''Advanced Procedure'', ''Endodontics'', ''OE Possible Same Day AP'' and ''Post AP Recheck'' all bill into this group. The department revenue is the lines in this product_group; an AP case also generates anesthesia, lab and medication lines in other groups, so the whole-case value is higher — say which one you computed.',
   'select location_key as clinic, round(sum(total_incl)::numeric, 2) as revenue from ezyvet_invoice_line where product_group = ''*AP Dental/Endodontics'' and line_date = <date> group by location_key order by revenue desc'),
  ('service line',
   array['department revenue','revenue by department','by service line','which department'],
   'A department''s revenue is the invoice lines billed under its product_group, an exact closed set of values that does not match how the team names departments: AP/dentistry = ''*AP Dental/Endodontics''; surgery = ''*Surgical Procedure'' (outside specialists = ''Specialty Surgery''); internal medicine/IM = ''*Internal Medicine''; cardio = ''Cardiology''; urgent care/UC = ''Urgent Care Appointments''; exotics = ''*Exotics''; imaging/CT/MRI = ''Advanced Imaging'' (plus ''Ultrasound'', ''*Radiography'', ''Radiology Review''); labs/bloodwork = ''*Laboratory- External'' and ''*Laboratory- In-House''; pharmacy/meds = ''Medications - Rx'' and ''*Controlled Substances - Rx''. Never match a service line with ILIKE ''%procedure%'' or ''%surg%'' — that hits the surgical group and misses AP.',
   'select product_group, round(sum(total_incl)::numeric, 2) as revenue from ezyvet_invoice_line where product_group in (<exact values>) and line_date between <start> and <end> group by product_group order by revenue desc'),
  ('by clinic',
   array['per clinic','by location','by hospital','each clinic','which clinic'],
   'ezyvet_invoice_line.location_key has exactly four values: ''van_nuys'', ''venice'', ''sherman_oaks'' and ''other''. Group on it (or location_label on the report_* views) and keep the ''other''/unknown bucket as its own row so the clinic rows add up to the total. A clinic can never be derived from ezyvet_contact.division, which only has ''GDD & MPMV'' and ''Green Dog - Sherman Oaks''.',
   'select location_key as clinic, round(sum(total_incl)::numeric, 2) as revenue from ezyvet_invoice_line where line_date = <date> group by location_key order by revenue desc')
on conflict (lower(term)) do update
  set aliases    = excluded.aliases,
      definition = excluded.definition,
      sql_hint   = excluded.sql_hint,
      status     = 'active',
      updated_at = now();
