-- Ask Ziggy lookup functions (migrations 0233, 0234): behaviour test on SYNTHETIC rows.
--
-- Run against STAGING only:
--   SUPABASE_PROJECT_REF=yzxcuiwklrmxarzjzukr scripts/supabase-sql.sh -f scripts/ziggy_lookup_test.sql
--
-- Everything runs inside one DO block that always ends by raising, so every
-- insert is rolled back. Success is the error text "ZIGGY_FN_TEST_PASS";
-- anything else names the failing check.
do $$
declare
  n int; s numeric; c text[]; msg text;
begin
  -- 11 clients sharing a surname fragment, one unique client.
  insert into greendogops.ezyvet_contact (ezyvet_contact_id, contact_code, first_name, last_name, full_name, is_customer, revenue_spend_ytd)
  select 'zzq-c-' || i, 'ZZQ' || i, 'Pat', 'Zzqmany' || i, 'Pat Zzqmany' || i, true, 100 from generate_series(1, 11) i;
  insert into greendogops.ezyvet_contact (ezyvet_contact_id, contact_code, first_name, last_name, full_name, is_customer, revenue_spend_ytd)
  values ('zzq-c-u', 'ZZQU', 'Jane', 'Zzqunique', 'Jane Zzqunique', true, 321.5);
  insert into greendogops.ezyvet_animal (ezyvet_animal_id, animal_code, animal_name, species, owner_contact_code)
  select 'zzq-a-' || i, 'ZZQA' || i, 'Zzqpet', 'Canine (dog)', 'ZZQ' || i from generate_series(1, 11) i;
  insert into greendogops.ezyvet_animal (ezyvet_animal_id, animal_code, animal_name, species, owner_contact_code)
  values ('zzq-a-u', 'ZZQAU', 'Zzqmax', 'Canine (dog)', 'ZZQU');
  insert into greendogops.ezyvet_invoice_line (invoice_line_id, invoice_no, line_date, invoice_date, client_contact_code, first_name, last_name, animal_code, pet_name, species, product_name, product_group, qty, total_excl, total_incl, location_label, case_owner)
  values ('zzq-l1', 'ZZQ-INV1', '2026-03-14', '2026-03-14', 'ZZQU', 'Jane', 'Zzqunique', 'ZZQAU', 'Zzqmax', 'Canine (dog)', 'Exam - Zzq', 'Consults', 1, 80, 86.6, 'Venice', 'Dr Test'),
         ('zzq-l2', 'ZZQ-INV1', '2026-03-14', '2026-03-14', 'ZZQU', 'Jane', 'Zzqunique', 'ZZQAU', 'Zzqmax', 'Canine (dog)', 'Dental - Zzq', 'Dental', 1, 400, 433, 'Venice', 'Dr Test'),
         ('zzq-l3', 'ZZQ-INV2', '2026-05-01', '2026-05-01', 'ZZQU', 'Jane', 'Zzqunique', 'ZZQAU', 'Zzqmax', 'Canine (dog)', 'Carprofen - Zzq', 'Medications', 30, 30, 32.4, 'Venice', 'Dr Test'),
         -- a client code with no contact row (34k such lines in production)
         ('zzq-l4', 'ZZQ-INV3', '2026-06-01', '2026-06-01', 'ZZQORPHAN', 'Orphan', 'Zzqorphan', null, null, null, 'Exam - Zzq', 'Consults', 1, 80, 86.6, 'Venice', 'Dr Test');

  -- 1. exact code
  if greendogops.ziggy_client_codes('ZZQU') <> array['ZZQU'] then raise exception 'FAIL exact client code'; end if;
  -- 2. unique name fragment
  if greendogops.ziggy_client_codes('jane zzqunique') <> array['ZZQU'] then raise exception 'FAIL client name'; end if;
  -- 3. invoice-line-only client is found by name
  if greendogops.ziggy_client_codes('Orphan Zzqorphan') <> array['ZZQORPHAN'] then raise exception 'FAIL orphan client'; end if;
  -- 4. more than 10 matches raises
  begin
    c := greendogops.ziggy_client_codes('Zzqmany');
    raise exception 'FAIL cap not enforced (%)', cardinality(c);
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    if msg not like 'More than 10 clients match%' then raise exception '%', msg; end if;
  end;
  -- 5. wildcards are literal, too-short input raises
  if cardinality(greendogops.ziggy_client_codes('%%')) <> 0 then raise exception 'FAIL %% wildcard matched'; end if;
  if cardinality(greendogops.ziggy_client_codes('__')) <> 0 then raise exception 'FAIL __ wildcard matched'; end if;
  begin
    c := greendogops.ziggy_client_codes('%');
    raise exception 'FAIL short input accepted';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    if msg not like 'Give a client name%' then raise exception '%', msg; end if;
  end;
  -- 6. one visit's charges
  select sum(charge_incl_tax), count(*) into s, n from greendogops.client_visits('Jane Zzqunique') where visit_date = '2026-03-14';
  if s <> 519.6 or n <> 2 then raise exception 'FAIL client_visits visit total % / %', s, n; end if;
  -- 7. summary
  select spend_since_2025, billed_visit_days_since_2025 into s, n from greendogops.client_summary('ZZQU');
  if s <> 552.0 or n <> 2 then raise exception 'FAIL client_summary % / %', s, n; end if;
  if (select spend_ytd_per_ezyvet from greendogops.client_summary('ZZQU')) <> 321.5 then raise exception 'FAIL ytd'; end if;
  if (select pets from greendogops.client_summary('ZZQU')) not like 'Zzqmax (Canine (dog), ZZQAU)%' then raise exception 'FAIL pets'; end if;
  -- 8. patient history and cap
  select count(*) into n from greendogops.patient_visits('Zzqmax') where item_group = 'Dental';
  if n <> 1 then raise exception 'FAIL patient_visits dental %', n; end if;
  begin
    c := greendogops.ziggy_patient_codes('Zzqpet');
    raise exception 'FAIL patient cap not enforced';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    if msg not like 'More than 10 patients match%' then raise exception '%', msg; end if;
  end;
  if greendogops.ziggy_patient_codes('ZZQA3') <> array['ZZQA3'] then raise exception 'FAIL exact animal code'; end if;
  -- 9. no money-reporting columns on the catalog view
  if exists (select 1 from information_schema.columns where table_schema = 'greendogops' and table_name = 'product_catalog'
             and column_name in ('cost', 'markup', 'margin_dollars')) then raise exception 'FAIL product_catalog exposes cost'; end if;

  -- 10. (0234) an exact surname wins over many substring matches
  insert into greendogops.ezyvet_contact (ezyvet_contact_id, contact_code, first_name, last_name, full_name, is_customer)
  select 'zzq-h-' || i, 'ZZQH' || i, 'Kim', 'Zzqheoson' || i, 'Kim Zzqheoson' || i, true from generate_series(1, 11) i;
  insert into greendogops.ezyvet_contact (ezyvet_contact_id, contact_code, first_name, last_name, full_name, is_customer)
  values ('zzq-h-x', 'ZZQHX', 'Tam', 'Zzqheo', 'Tam Zzqheo', true);
  if greendogops.ziggy_client_codes('zzqheo') <> array['ZZQHX'] then raise exception 'FAIL exact surname tier'; end if;
  -- 11. (0234) an exact pet name wins over substring matches
  insert into greendogops.ezyvet_animal (ezyvet_animal_id, animal_code, animal_name, owner_contact_code)
  select 'zzq-p-' || i, 'ZZQP' || i, 'Zzqbo' || i, 'ZZQU' from generate_series(1, 11) i;
  insert into greendogops.ezyvet_animal (ezyvet_animal_id, animal_code, animal_name, owner_contact_code)
  values ('zzq-p-x', 'ZZQPX', 'Zzqbo', 'ZZQU');
  if greendogops.ziggy_patient_codes('ZZQBO') <> array['ZZQPX'] then raise exception 'FAIL exact pet name tier'; end if;

  raise exception 'ZIGGY_FN_TEST_PASS (all changes rolled back)';
end $$;
