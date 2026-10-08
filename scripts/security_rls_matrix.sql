-- ============================================================================
-- RLS role matrix — "Can Employee A see Employee B?" (docs/security.md §Testing)
--
-- Run against STAGING (never production):
--   SUPABASE_PROJECT_REF=<staging_ref> scripts/supabase-sql.sh -f scripts/security_rls_matrix.sql
--
-- It creates fixtures, impersonates the first app_user in every role through
-- `set local role authenticated` + request.jwt.claims (exactly what PostgREST
-- does), probes each sensitive boundary, then ABORTS with the results as the
-- error message — so nothing it wrote survives. The expected output is checked
-- by the final block: a FAIL line means a boundary regressed.
-- ============================================================================
do $$
declare
  v_uid     uuid := (select id from greendogops.app_user order by created_at limit 1);
  v_self    uuid;
  v_other   uuid;
  v_cand    uuid;
  v_role    text;
  v_n       integer;
  v_txt     text;
  r         jsonb := '{}'::jsonb;
  row_res   jsonb;
  failures  text[] := '{}';
  hr_full   boolean;
  cand_edit boolean;
begin
  if v_uid is null then
    raise exception 'needs at least one app_user';
  end if;

  -- Fixtures (as the migration owner, RLS bypassed) -------------------------
  insert into greendogops.person (first_name, last_name, status)
    values ('Rls', 'Self', 'employee') returning id into v_self;
  insert into greendogops.person (first_name, last_name, status)
    values ('Rls', 'Other', 'employee') returning id into v_other;
  insert into greendogops.person (first_name, last_name, status)
    values ('Rls', 'Candidate', 'applicant') returning id into v_cand;
  insert into greendogops.person_review (person_id, review_type)
    values (v_self, 'rls-test'), (v_other, 'rls-test');
  insert into greendogops.person_disciplinary_action (person_id)
    values (v_other);
  insert into greendogops.person_document (person_id, title, storage_path)
    values (v_self, 'rls', 'rls/self'), (v_other, 'rls', 'rls/other'), (v_cand, 'rls', 'rls/cand');
  insert into greendogops.person_employment (person_id, current_rate, hire_date)
    values (v_other, 99, '2020-01-01'), (v_self, 55, '2021-01-01')
    on conflict (person_id) do update set current_rate = excluded.current_rate;
  update greendogops.app_user
    set person_id = v_self, module_access = '{}'::jsonb, is_active = true
    where id = v_uid;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal1')::text,
    true
  );

  foreach v_role in array array['staff', 'schedule_admin', 'marketing_admin', 'manager', 'executive', 'admin', 'owner'] loop
    execute 'reset role';
    execute format('update greendogops.app_user set role = %L where id = %L', v_role, v_uid);
    hr_full := v_role in ('owner', 'admin', 'executive', 'manager');
    cand_edit := v_role <> 'staff';
    row_res := '{}'::jsonb;

    execute 'set local role authenticated';

    select count(*) into v_n from greendogops.person_review where person_id = v_other and review_type = 'rls-test';
    row_res := row_res || jsonb_build_object('read_other_review', v_n);
    if (v_n > 0) <> hr_full then failures := failures || format('%s read_other_review=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.person_review where person_id = v_self and review_type = 'rls-test';
    row_res := row_res || jsonb_build_object('read_own_review', v_n);
    if v_n <> 1 then failures := failures || format('%s read_own_review=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.person_disciplinary_action where person_id = v_other;
    row_res := row_res || jsonb_build_object('read_other_discipline', v_n);
    if (v_n > 0) <> hr_full then failures := failures || format('%s read_other_discipline=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.person_document where person_id = v_other;
    row_res := row_res || jsonb_build_object('read_other_doc', v_n);
    if (v_n > 0) <> hr_full then failures := failures || format('%s read_other_doc=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.person_document where person_id = v_cand and storage_path = 'rls/cand';
    row_res := row_res || jsonb_build_object('read_candidate_doc', v_n);
    if v_n <> 1 then failures := failures || format('%s read_candidate_doc=%s', v_role, v_n); end if;

    -- Compensation is never readable through the API role.
    begin
      execute format('select current_rate::text from greendogops.person_employment where person_id = %L', v_self) into v_txt;
      row_res := row_res || jsonb_build_object('read_comp', 'ALLOWED');
      failures := failures || format('%s read_comp allowed', v_role);
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('read_comp', 'denied');
    end;

    begin
      execute format('select hire_date::text from greendogops.person_employment where person_id = %L', v_other) into v_txt;
      row_res := row_res || jsonb_build_object('read_hire_date', coalesce(v_txt, 'null'));
      if v_txt is null then failures := failures || format('%s read_hire_date null', v_role); end if;
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('read_hire_date', 'DENIED');
      failures := failures || format('%s read_hire_date denied', v_role);
    end;

    begin
      execute format('update greendogops.person_employment set current_rate = 1 where person_id = %L', v_self);
      row_res := row_res || jsonb_build_object('write_comp', 'ALLOWED');
      failures := failures || format('%s write_comp allowed', v_role);
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('write_comp', 'denied');
    end;

    begin
      perform 1 from greendogops.audit_log limit 1;
      row_res := row_res || jsonb_build_object('read_audit', 'ALLOWED');
      failures := failures || format('%s read_audit allowed', v_role);
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('read_audit', 'denied');
    end;

    begin
      insert into greendogops.person_review (person_id, review_type) values (v_other, 'rls-write');
      row_res := row_res || jsonb_build_object('write_other_review', 'allowed');
      if not hr_full then failures := failures || format('%s write_other_review allowed', v_role); end if;
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('write_other_review', 'denied');
      if hr_full then failures := failures || format('%s write_other_review denied', v_role); end if;
    end;

    begin
      insert into greendogops.person_document (person_id, title, storage_path) values (v_cand, 'rls', 'rls/cand2');
      row_res := row_res || jsonb_build_object('write_candidate_doc', 'allowed');
      if not cand_edit then failures := failures || format('%s write_candidate_doc allowed', v_role); end if;
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('write_candidate_doc', 'denied');
      if cand_edit then failures := failures || format('%s write_candidate_doc denied', v_role); end if;
    end;

    r := r || jsonb_build_object(v_role, row_res);
  end loop;

  -- Per-user module overrides are honoured by the policies too.
  execute 'reset role';
  update greendogops.app_user set role = 'staff', module_access = '{"ats": false}'::jsonb where id = v_uid;
  execute 'set local role authenticated';
  select count(*) into v_n from greendogops.person_document where person_id = v_cand and storage_path = 'rls/cand';
  r := r || jsonb_build_object('staff_ats_off_read_candidate_doc', v_n);
  if v_n <> 0 then failures := failures || 'staff with ats=false still reads candidate docs'::text; end if;

  execute 'reset role';
  update greendogops.app_user set role = 'manager', module_access = '{"hr": false}'::jsonb where id = v_uid;
  execute 'set local role authenticated';
  begin
    insert into greendogops.person_review (person_id, review_type) values (v_other, 'rls-override');
    r := r || jsonb_build_object('manager_hr_off_write_review', 'ALLOWED');
    failures := failures || 'manager with hr=false can still write reviews'::text;
  exception when insufficient_privilege then
    r := r || jsonb_build_object('manager_hr_off_write_review', 'denied');
  end;
  execute 'reset role';
  update greendogops.app_user set module_access = '{}'::jsonb where id = v_uid;

  -- MFA: once a verified factor exists, an aal1 session is no longer a GDO user.
  execute 'reset role';
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), v_uid, 'rls-test', 'totp', 'verified', now(), now());
  execute 'set local role authenticated';
  r := r || jsonb_build_object('mfa_aal1_is_gdo_user', greendogops.is_gdo_user());
  if greendogops.is_gdo_user() then failures := failures || 'mfa aal1 still allowed'::text; end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated', 'aal', 'aal2')::text,
    true
  );
  r := r || jsonb_build_object('mfa_aal2_is_gdo_user', greendogops.is_gdo_user());
  if not greendogops.is_gdo_user() then failures := failures || 'mfa aal2 denied'::text; end if;

  -- Audit log is append-only even for the owner role.
  execute 'reset role';
  begin
    update greendogops.audit_log set summary = summary where id = (select id from greendogops.audit_log limit 1);
    delete from greendogops.audit_log where false;
    insert into greendogops.audit_log (action) values ('rls-test') returning id::text into v_txt;
    delete from greendogops.audit_log where id::text = v_txt;
    r := r || jsonb_build_object('audit_delete_as_owner', 'ALLOWED');
    failures := failures || 'audit delete allowed'::text;
  exception when insufficient_privilege then
    r := r || jsonb_build_object('audit_delete_as_owner', 'denied');
  end;

  raise exception 'RLS_MATRIX % %',
    case when cardinality(failures) = 0 then 'PASS' else 'FAIL ' || array_to_string(failures, '; ') end,
    r::text;
end $$;
