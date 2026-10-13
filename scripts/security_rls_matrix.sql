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
  cand_read boolean;
  -- Resource documents (0235)
  v_doc_public uuid;
  v_doc_staff  uuid;
  v_doc_named  uuid;
  v_doc_hidden uuid;
  v_doc_ver    uuid;
  role_staff   boolean;
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

  -- Resource documents: everyone / staff role / named viewer / nobody named.
  insert into greendogops.resource_document (title, source_url, visible_roles)
    values ('rls-doc-public', 'https://example.com/a', null) returning id into v_doc_public;
  insert into greendogops.resource_document (title, source_url, visible_roles)
    values ('rls-doc-staff', 'https://example.com/b', array['staff']) returning id into v_doc_staff;
  insert into greendogops.resource_document (title, source_url, visible_roles)
    values ('rls-doc-named', 'https://example.com/c', '{}') returning id into v_doc_named;
  insert into greendogops.resource_document (title, source_url, visible_roles)
    values ('rls-doc-hidden', 'https://example.com/d', '{}') returning id into v_doc_hidden;
  insert into greendogops.resource_document_viewer (document_id, app_user_id)
    values (v_doc_named, v_uid);
  insert into greendogops.resource_document_chunk (document_id, chunk_index, content)
    values (v_doc_hidden, 0, 'rls hidden chunk');
  insert into greendogops.resource_document_version (document_id, version_no, title, content_json)
    values (v_doc_public, 1, 'rls-doc-public', '{"type":"doc"}') returning id into v_doc_ver;
  insert into greendogops.resource_document_signature
    (document_id, version_id, version_no, document_title, app_user_id, signer_name, initials, signed_on)
  values
    (v_doc_public, v_doc_ver, 1, 'rls-doc-public', v_uid, 'Rls Self', 'RS', current_date),
    (v_doc_public, v_doc_ver, 1, 'rls-doc-public', null, 'Rls Other', 'RO', current_date);
  insert into greendogops.person_disciplinary_action (person_id)
    values (v_other);
  insert into greendogops.person_document (person_id, title, storage_path)
    values (v_self, 'rls', 'rls/self'), (v_other, 'rls', 'rls/other'), (v_cand, 'rls', 'rls/cand');
  insert into greendogops.profile_transition_log (person_id, event_type, detail)
    values (v_cand, 'rls-test', 'rls candidate history');
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
    -- Staff have no Recruiting module by default (0237).
    cand_read := v_role <> 'staff';
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
    if (v_n > 0) <> cand_read then failures := failures || format('%s read_candidate_doc=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.profile_transition_log where person_id = v_cand and event_type = 'rls-test';
    row_res := row_res || jsonb_build_object('read_candidate_history', v_n);
    if (v_n > 0) <> cand_read then failures := failures || format('%s read_candidate_history=%s', v_role, v_n); end if;

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

    -- Resource documents (0235) --------------------------------------------
    role_staff := v_role = 'staff';
    select count(*) into v_n from greendogops.resource_document where id = v_doc_public;
    row_res := row_res || jsonb_build_object('doc_public', v_n);
    if v_n <> 1 then failures := failures || format('%s doc_public=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.resource_document where id = v_doc_staff;
    row_res := row_res || jsonb_build_object('doc_staff_role', v_n);
    if (v_n > 0) <> (hr_full or role_staff) then failures := failures || format('%s doc_staff_role=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.resource_document where id = v_doc_named;
    row_res := row_res || jsonb_build_object('doc_named_viewer', v_n);
    if v_n <> 1 then failures := failures || format('%s doc_named_viewer=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.resource_document where id = v_doc_hidden;
    row_res := row_res || jsonb_build_object('doc_hidden', v_n);
    if (v_n > 0) <> hr_full then failures := failures || format('%s doc_hidden=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.resource_document_chunk where document_id = v_doc_hidden;
    row_res := row_res || jsonb_build_object('doc_hidden_chunk', v_n);
    if (v_n > 0) <> hr_full then failures := failures || format('%s doc_hidden_chunk=%s', v_role, v_n); end if;

    select count(*) into v_n from greendogops.resource_document_signature where document_id = v_doc_public;
    row_res := row_res || jsonb_build_object('doc_signatures', v_n);
    if v_n <> (case when hr_full then 2 else 1 end) then failures := failures || format('%s doc_signatures=%s', v_role, v_n); end if;

    begin
      update greendogops.resource_document set title = 'rls-hacked' where id = v_doc_public;
      get diagnostics v_n = row_count;
      row_res := row_res || jsonb_build_object('doc_write', case when v_n > 0 then 'ALLOWED' else 'denied' end);
      if v_n > 0 then failures := failures || format('%s doc_write allowed', v_role); end if;
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('doc_write', 'denied');
    end;

    begin
      insert into greendogops.resource_document_signature
        (document_id, version_id, version_no, document_title, app_user_id, signer_name, initials, signed_on)
      values (v_doc_public, v_doc_ver, 1, 'x', null, 'Forged', 'FG', current_date);
      row_res := row_res || jsonb_build_object('signature_write', 'ALLOWED');
      failures := failures || format('%s signature_write allowed', v_role);
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('signature_write', 'denied');
    end;

    begin
      perform greendogops.search_resource_content('rls', v_uid, 1);
      row_res := row_res || jsonb_build_object('search_rpc', 'ALLOWED');
      failures := failures || format('%s search_resource_content callable', v_role);
    exception when insufficient_privilege then
      row_res := row_res || jsonb_build_object('search_rpc', 'denied');
    end;

    r := r || jsonb_build_object(v_role, row_res);
  end loop;

  -- Ask Ziggy's passage search only returns documents the asker may view.
  execute 'reset role';
  update greendogops.app_user set role = 'staff', module_access = '{}'::jsonb where id = v_uid;
  select count(*) into v_n from greendogops.search_resource_content('rls hidden chunk', v_uid, 25) s
   where s.document_id = v_doc_hidden;
  r := r || jsonb_build_object('search_hidden_as_staff', v_n);
  if v_n <> 0 then failures := failures || 'search returns hidden doc to staff'::text; end if;
  update greendogops.app_user set role = 'manager' where id = v_uid;
  select count(*) into v_n from greendogops.search_resource_content('rls hidden chunk', v_uid, 25) s
   where s.document_id = v_doc_hidden;
  r := r || jsonb_build_object('search_hidden_as_manager', v_n);
  if v_n <> 1 then failures := failures || 'search hides doc from manager'::text; end if;
  select count(*) into v_n from greendogops.search_resource_content('rls hidden chunk', null, 25) s
   where s.document_id = v_doc_hidden;
  if v_n <> 0 then failures := failures || 'search with no asker returns restricted doc'::text; end if;

  -- Per-user module overrides are honoured by the policies too.
  execute 'reset role';
  update greendogops.app_user set role = 'staff', module_access = '{"ats": false}'::jsonb where id = v_uid;
  execute 'set local role authenticated';
  select count(*) into v_n from greendogops.person_document where person_id = v_cand and storage_path = 'rls/cand';
  r := r || jsonb_build_object('staff_ats_off_read_candidate_doc', v_n);
  if v_n <> 0 then failures := failures || 'staff with ats=false still reads candidate docs'::text; end if;

  execute 'reset role';
  update greendogops.app_user set role = 'staff', module_access = '{"ats": true}'::jsonb where id = v_uid;
  execute 'set local role authenticated';
  select count(*) into v_n from greendogops.person_document where person_id = v_cand and storage_path = 'rls/cand';
  r := r || jsonb_build_object('staff_ats_on_read_candidate_doc', v_n);
  if v_n <> 1 then failures := failures || 'staff with ats=true cannot read candidate docs'::text; end if;
  select count(*) into v_n from greendogops.profile_transition_log where person_id = v_cand and event_type = 'rls-test';
  r := r || jsonb_build_object('staff_ats_on_read_candidate_history', v_n);
  if v_n <> 1 then failures := failures || 'staff with ats=true cannot read candidate history'::text; end if;

  execute 'reset role';
  update greendogops.app_user set role = 'schedule_admin', module_access = '{"ats": false}'::jsonb where id = v_uid;
  execute 'set local role authenticated';
  select count(*) into v_n from greendogops.person_document where person_id = v_cand and storage_path = 'rls/cand';
  r := r || jsonb_build_object('sched_admin_ats_off_read_candidate_doc', v_n);
  if v_n <> 0 then failures := failures || 'schedule_admin with ats=false still reads candidate docs'::text; end if;

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

  -- Staff are read-only in the database (0239), even with module overrides;
  -- other roles still write. Definer RPCs are closed to every API token (0238).
  execute 'reset role';
  update greendogops.app_user
     set role = 'staff', module_access = '{"hr": true, "schedule": true, "crm_referral": true}'::jsonb
   where id = v_uid;
  execute 'set local role authenticated';
  select count(*) into v_n from greendogops.person where id in (v_self, v_other);
  r := r || jsonb_build_object('staff_read_person', v_n);
  if v_n <> 2 then failures := failures || format('staff cannot read person rows (%s)', v_n); end if;
  update greendogops.person set notes = 'rls-staff' where id in (v_self, v_other);
  get diagnostics v_n = row_count;
  r := r || jsonb_build_object('staff_update_person', v_n);
  if v_n <> 0 then failures := failures || 'staff updates person'::text; end if;
  delete from greendogops.person where id = v_other;
  get diagnostics v_n = row_count;
  r := r || jsonb_build_object('staff_delete_person', v_n);
  if v_n <> 0 then failures := failures || 'staff deletes person'::text; end if;
  begin
    insert into greendogops.person (first_name, last_name, status) values ('Rls', 'Forged', 'employee');
    r := r || jsonb_build_object('staff_insert_person', 'ALLOWED');
    failures := failures || 'staff inserts person'::text;
  exception when insufficient_privilege then
    r := r || jsonb_build_object('staff_insert_person', 'denied');
  end;
  update greendogops.app_user set role = 'owner' where id = v_uid;
  get diagnostics v_n = row_count;
  r := r || jsonb_build_object('staff_self_promote', v_n);
  if v_n <> 0 then failures := failures || 'staff can change own app_user role'::text; end if;
  begin
    perform greendogops.appointment_review(current_date - 7, current_date - 1);
    r := r || jsonb_build_object('staff_definer_rpc', 'ALLOWED');
    failures := failures || 'staff calls appointment_review'::text;
  exception when insufficient_privilege then
    r := r || jsonb_build_object('staff_definer_rpc', 'denied');
  end;
  begin
    perform greendogops.medical_board_patch_card(gen_random_uuid(), '{}'::jsonb, 'rls');
    r := r || jsonb_build_object('staff_board_patch_rpc', 'ALLOWED');
    failures := failures || 'staff calls medical_board_patch_card'::text;
  exception when insufficient_privilege then
    r := r || jsonb_build_object('staff_board_patch_rpc', 'denied');
  end;

  execute 'reset role';
  update greendogops.app_user set role = 'schedule_admin', module_access = '{}'::jsonb where id = v_uid;
  execute 'set local role authenticated';
  update greendogops.person set notes = 'rls-sched-admin' where id = v_other;
  get diagnostics v_n = row_count;
  r := r || jsonb_build_object('schedule_admin_update_person', v_n);
  if v_n <> 1 then failures := failures || 'schedule_admin can no longer write person'::text; end if;

  execute 'reset role';
  begin
    update greendogops.app_user set role = 'employee' where id = v_uid;
    r := r || jsonb_build_object('retired_employee_role', 'ALLOWED');
    failures := failures || 'app_user accepts the retired employee role'::text;
  exception when check_violation then
    r := r || jsonb_build_object('retired_employee_role', 'rejected');
  end;
  update greendogops.app_user set role = 'staff', module_access = '{}'::jsonb where id = v_uid;

  select count(*) into v_n from greendogops.rls_audit() a
   where a.problem like 'Staff not read-only%';
  r := r || jsonb_build_object('tables_staff_can_write', v_n);
  if v_n <> 0 then failures := failures || format('%s tables Staff can write', v_n); end if;

  -- No SECURITY DEFINER function is callable by any API token (0238).
  select count(*) into v_n from greendogops.rls_audit() a
   where a.problem = 'SECURITY DEFINER executable by authenticated';
  r := r || jsonb_build_object('definer_fns_open_to_authenticated', v_n);
  if v_n <> 0 then failures := failures || format('%s SECURITY DEFINER functions open to authenticated', v_n); end if;

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
