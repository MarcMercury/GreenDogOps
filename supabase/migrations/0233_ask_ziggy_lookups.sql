--
-- 0233_ask_ziggy_lookups.sql
--
-- What every employee (the Ask Ziggy "general" tier) may look up without
-- getting revenue REPORTING:
--
--   * product_catalog — every product/service with its RETAIL price per
--     division ("how much is a vet exam?"). Cost, markup and margin stay out.
--   * client_summary(text), client_visits(text), patient_visits(text) — what
--     ONE client spent / was charged ("how much did Jane Smith pay on 3/14?",
--     "when was Max's last dental?"). Each call resolves to at most 10 clients
--     or patients and raises otherwise, so a call cannot become "all revenue".
--     Ask Ziggy additionally only accepts them with a literal argument for
--     the general tier (smart-scope.ts), so they cannot be joined across every
--     client.
--   * staff_directory — who works here (names, job title, home location,
--     email); no DOB, home phones, notes or pay.
--   * schedule_roster — who is working where and when, published weeks only,
--     without attendance notes.
--
-- Revenue roll-ups (ezyvet_invoice_line, report_* revenue views, location
-- totals) remain unavailable to the general tier.
--
-- All objects are service-role only (Ask Ziggy reads them through
-- smart_query()); the protect_new_objects event trigger applies the same, and
-- the explicit revokes below make that independent of the trigger.

begin;

-- Lookups by code. contact_code / animal_code are not unique (re-imports), so
-- these are plain indexes.
create index if not exists idx_ezv_line_animal on greendogops.ezyvet_invoice_line (animal_code);
create index if not exists idx_ezv_contact_code on greendogops.ezyvet_contact (contact_code);
create index if not exists idx_ezv_animal_code on greendogops.ezyvet_animal (animal_code);

-- ---------------------------------------------------------------------------
-- Resolve a client / patient reference to at most 10 codes.
-- ---------------------------------------------------------------------------
create or replace function greendogops.ziggy_client_codes(p_client text)
returns text[]
language plpgsql
stable
set search_path = greendogops, pg_temp
as $$
declare
  v text := btrim(coalesce(p_client, ''));
  v_like text;
  v_codes text[];
begin
  if length(v) < 2 then
    raise exception 'Give a client name (at least 2 characters) or their ezyVet contact code.';
  end if;

  -- An exact contact code wins.
  select array_agg(distinct s.code) into v_codes
    from (
      select c.contact_code as code from greendogops.ezyvet_contact c where c.contact_code = v
      union
      select l.client_contact_code from greendogops.ezyvet_invoice_line l where l.client_contact_code = v
    ) s;
  if v_codes is not null then
    return v_codes;
  end if;

  -- Otherwise a name fragment, with LIKE wildcards in the input neutralised.
  v_like := '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select array_agg(m.code) into v_codes
    from (
      select distinct u.code
        from (
          select c.contact_code as code
            from greendogops.ezyvet_contact c
           where c.full_name ilike v_like
              or concat_ws(' ', c.first_name, c.last_name) ilike v_like
              or c.business_name ilike v_like
          union
          -- ~34k invoice lines carry a client code with no contact row.
          select l.client_contact_code
            from greendogops.ezyvet_invoice_line l
           where concat_ws(' ', l.first_name, l.last_name) ilike v_like
              or l.business_name ilike v_like
        ) u
       where coalesce(u.code, '') <> ''
       limit 11
    ) m;

  if cardinality(v_codes) > 10 then
    raise exception 'More than 10 clients match "%". Use the ezyVet contact code or the client''s full name.', v;
  end if;
  return coalesce(v_codes, '{}'::text[]);
end;
$$;

comment on function greendogops.ziggy_client_codes(text) is
  'Ask Ziggy: contact codes for one client reference (exact code, else name fragment); raises when more than 10 match.';

create or replace function greendogops.ziggy_patient_codes(p_patient text)
returns text[]
language plpgsql
stable
set search_path = greendogops, pg_temp
as $$
declare
  v text := btrim(coalesce(p_patient, ''));
  v_like text;
  v_codes text[];
begin
  if length(v) < 2 then
    raise exception 'Give a patient name (at least 2 characters) or their ezyVet animal code.';
  end if;

  select array_agg(distinct s.code) into v_codes
    from (
      select a.animal_code as code from greendogops.ezyvet_animal a where a.animal_code = v
      union
      select l.animal_code from greendogops.ezyvet_invoice_line l where l.animal_code = v
    ) s;
  if v_codes is not null then
    return v_codes;
  end if;

  v_like := '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select array_agg(m.code) into v_codes
    from (
      select distinct a.animal_code as code
        from greendogops.ezyvet_animal a
       where a.animal_name ilike v_like
         and coalesce(a.animal_code, '') <> ''
       limit 11
    ) m;

  if cardinality(v_codes) > 10 then
    raise exception 'More than 10 patients match "%". Find the right one in ezyvet_animal (owner, species, breed) and pass its animal_code.', v;
  end if;
  return coalesce(v_codes, '{}'::text[]);
end;
$$;

comment on function greendogops.ziggy_patient_codes(text) is
  'Ask Ziggy: animal codes for one patient reference (exact code, else name fragment); raises when more than 10 match.';

-- ---------------------------------------------------------------------------
-- One client: contact details, pets and what they have spent.
-- ---------------------------------------------------------------------------
create or replace function greendogops.client_summary(p_client text)
returns table (
  client_code text,
  client_name text,
  email text,
  phone text,
  mobile text,
  customer_group text,
  client_since date,
  last_visit date,
  pets text,
  spend_ytd_per_ezyvet numeric,
  spend_since_2025 numeric,
  billed_visit_days_since_2025 integer,
  first_billed_visit_since_2025 date,
  last_billed_visit date
)
language plpgsql
stable
set search_path = greendogops, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  with codes as (
    select unnest(greendogops.ziggy_client_codes(p_client)) as code
  ),
  contact as (
    select distinct on (c.contact_code) c.*
      from greendogops.ezyvet_contact c
      join codes on codes.code = c.contact_code
     order by c.contact_code, c.ezyvet_modified_at desc nulls last, c.updated_at desc
  ),
  billed as (
    select l.client_contact_code as code,
           max(nullif(btrim(concat_ws(' ', l.first_name, l.last_name)), '')) as name,
           sum(l.total_incl) as spend,
           count(distinct l.line_date)::integer as visit_days,
           min(l.line_date) as first_day,
           max(l.line_date) as last_day
      from greendogops.ezyvet_invoice_line l
      join codes on codes.code = l.client_contact_code
     group by l.client_contact_code
  ),
  pets as (
    select a.owner_contact_code as code,
           string_agg(a.animal_name || coalesce(' (' || a.species || ', ' || a.animal_code || ')', ''), ', '
                      order by a.animal_name) as pets
      from greendogops.ezyvet_animal a
      join codes on codes.code = a.owner_contact_code
     where not coalesce(a.has_passed_away, false)
     group by a.owner_contact_code
  )
  select codes.code,
         coalesce(nullif(btrim(contact.full_name), ''), nullif(contact.business_name, ''), billed.name),
         contact.email,
         contact.phone,
         contact.mobile,
         contact.customer_group,
         contact.ezyvet_created_at::date,
         contact.last_invoiced,
         pets.pets,
         contact.revenue_spend_ytd,
         billed.spend,
         billed.visit_days,
         billed.first_day,
         billed.last_day
    from codes
    left join contact on contact.contact_code = codes.code
    left join billed on billed.code = codes.code
    left join pets on pets.code = codes.code
   order by 2;
end;
$$;

comment on function greendogops.client_summary(text) is
  'Ask Ziggy: ONE client''s details, living pets and spend (ezyVet YTD figure, and billed total since 2025-01-02). '
  'Pass the client name or contact code as a plain quoted string: client_summary(''Jane Smith''). '
  'Raises if more than 10 clients match. Available to every employee.';

-- ---------------------------------------------------------------------------
-- Every billed line for one client / one patient.
-- ---------------------------------------------------------------------------
create or replace function greendogops.client_visits(p_client text)
returns table (
  client_code text,
  client_name text,
  visit_date date,
  invoice_no text,
  location text,
  pet_name text,
  animal_code text,
  item text,
  item_group text,
  qty numeric,
  charge_incl_tax numeric,
  charge_excl_tax numeric,
  vet text
)
language plpgsql
stable
set search_path = greendogops, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  select l.client_contact_code,
         coalesce(nullif(btrim(concat_ws(' ', l.first_name, l.last_name)), ''), l.business_name),
         l.line_date,
         l.invoice_no,
         l.location_label,
         l.pet_name,
         l.animal_code,
         l.product_name,
         l.product_group,
         l.qty,
         l.total_incl,
         l.total_excl,
         l.case_owner
    from greendogops.ezyvet_invoice_line l
   where l.client_contact_code = any (greendogops.ziggy_client_codes(p_client))
   order by l.line_date desc, l.invoice_no, l.product_name;
end;
$$;

comment on function greendogops.client_visits(text) is
  'Ask Ziggy: every billed line (date, item, qty, charge incl/excl tax, vet, location) for ONE client, '
  'from 2025-01-02. Pass the client name or contact code as a plain quoted string: '
  'client_visits(''Jane Smith''); filter by visit_date for one visit. Raises if more than 10 clients match.';

create or replace function greendogops.patient_visits(p_patient text)
returns table (
  animal_code text,
  pet_name text,
  species text,
  client_code text,
  client_name text,
  visit_date date,
  invoice_no text,
  location text,
  item text,
  item_group text,
  qty numeric,
  charge_incl_tax numeric,
  charge_excl_tax numeric,
  vet text
)
language plpgsql
stable
set search_path = greendogops, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  select l.animal_code,
         l.pet_name,
         l.species,
         l.client_contact_code,
         coalesce(nullif(btrim(concat_ws(' ', l.first_name, l.last_name)), ''), l.business_name),
         l.line_date,
         l.invoice_no,
         l.location_label,
         l.product_name,
         l.product_group,
         l.qty,
         l.total_incl,
         l.total_excl,
         l.case_owner
    from greendogops.ezyvet_invoice_line l
   where l.animal_code = any (greendogops.ziggy_patient_codes(p_patient))
   order by l.line_date desc, l.invoice_no, l.product_name;
end;
$$;

comment on function greendogops.patient_visits(text) is
  'Ask Ziggy: every billed line for ONE patient — services, medications dispensed, dental/surgical '
  'procedures, vaccines — with date, vet and charge, from 2025-01-02. Pass the animal_code (best) or '
  'name as a plain quoted string: patient_visits(''12345''). Raises if more than 10 patients match.';

revoke all on function greendogops.ziggy_client_codes(text) from public, anon, authenticated;
revoke all on function greendogops.ziggy_patient_codes(text) from public, anon, authenticated;
revoke all on function greendogops.client_summary(text) from public, anon, authenticated;
revoke all on function greendogops.client_visits(text) from public, anon, authenticated;
revoke all on function greendogops.patient_visits(text) from public, anon, authenticated;
grant execute on function greendogops.ziggy_client_codes(text) to service_role;
grant execute on function greendogops.ziggy_patient_codes(text) to service_role;
grant execute on function greendogops.client_summary(text) to service_role;
grant execute on function greendogops.client_visits(text) to service_role;
grant execute on function greendogops.patient_visits(text) to service_role;

-- ---------------------------------------------------------------------------
-- Views every employee may query in full.
-- ---------------------------------------------------------------------------
create or replace view greendogops.product_catalog as
select pr.product_code,
       coalesce(nullif(p.product_name, ''), pr.product_name) as product_name,
       coalesce(nullif(p.product_group, ''), pr.product_group) as product_group,
       p.product_type,
       p.clinical_type,
       p.description,
       pr.division,
       pr.sell_price_excl as retail_price_excl_tax,
       pr.sell_price_incl as retail_price_incl_tax,
       p.is_active,
       p.is_sold,
       p.requires_prescription,
       p.on_special,
       p.last_invoiced_date
  from greendogops.ezyvet_product_price pr
  left join greendogops.ezyvet_product p on p.product_code = pr.product_code;

comment on view greendogops.product_catalog is
  'Ask Ziggy: every product/service with its retail price per division (hospital). No cost, markup or margin.';

create or replace view greendogops.staff_directory as
select p.id as person_id,
       coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.full_name), ''),
                btrim(concat_ws(' ', p.first_name, p.last_name))) as name,
       p.first_name,
       p.last_name,
       p.status::text as status,
       coalesce(nullif(e.adp_job_title, ''), nullif(e.offer_title, '')) as job_title,
       l.name as home_location,
       p.email
  from greendogops.person p
  left join greendogops.person_employment e on e.person_id = p.id
  left join greendogops.location l on l.id = e.location_id
 where p.status in ('employee', 'contractor');

comment on view greendogops.staff_directory is
  'Ask Ziggy: current employees and contractors — name, job title, home location, email. No DOB, home phones, notes or pay.';

create or replace view greendogops.schedule_roster as
select a.work_date,
       l.name as location,
       d.name as department,
       r.name as role,
       wl.label as shift,
       wl.start_time,
       wl.end_time,
       a.person_id,
       coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.full_name), ''),
                btrim(concat_ws(' ', p.first_name, p.last_name))) as staff_name
  from greendogops.sched_assignment a
  join greendogops.sched_week w on w.id = a.week_id
  left join greendogops.sched_week_line wl on wl.id = a.line_id
  left join greendogops.sched_department d on d.id = wl.department_id
  left join greendogops.sched_role r on r.id = wl.role_id
  left join greendogops.location l on l.id = a.location_id
  left join greendogops.person p on p.id = a.person_id
 where w.status = 'published'
   and not w.is_template
   and not coalesce(a.removed_post_publish, false);

comment on view greendogops.schedule_roster is
  'Ask Ziggy: who is scheduled where and when, published weeks only, without attendance notes.';

revoke all on greendogops.product_catalog from anon, authenticated;
revoke all on greendogops.staff_directory from anon, authenticated;
revoke all on greendogops.schedule_roster from anon, authenticated;
grant select on greendogops.product_catalog to service_role;
grant select on greendogops.staff_directory to service_role;
grant select on greendogops.schedule_roster to service_role;

commit;
