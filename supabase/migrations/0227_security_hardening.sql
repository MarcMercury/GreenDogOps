-- ============================================================================
-- 0227 — Security hardening (OWASP ASVS L2 pass)
--
-- WHY: 0164 gave every active app_user full read/write on every table through
-- PostgREST (policy gdo_members_all). The app redacts sensitive HR data in
-- server code, but any signed-in user could skip the app and query the REST
-- API directly with their own session token: read every salary, every review
-- and disciplinary record, or edit/delete the audit log.
--
-- This migration moves the sensitive boundaries into the database while
-- mirroring exactly what the app already lets each role do:
--   1. No new RPCs: the role checks are inline subqueries on app_user, which
--      run under app_user's own read-self policy (so they only ever see the
--      caller's row) and mirror src/lib/auth/permissions.ts.
--   2. HR-only tables (reviews, discipline, assets, onboarding, compliance,
--      licenses) readable by HR roles (owner/admin/executive/manager) and by
--      the employee themself; writable only by HR roles with HR edit rights.
--   3. person_document / profile_transition_log: same, plus candidates
--      (prospect/applicant) stay visible to anyone with Recruiting access.
--   4. Compensation columns on person_employment are no longer granted to
--      `authenticated` at all. The app reads/writes them with the service-role
--      client after its own canViewAllCompensation / own-record check.
--   5. audit_log is append-only: no API role can read, update or delete it, and
--      a trigger blocks UPDATE/DELETE/TRUNCATE for every role.
--   6. MFA at the database layer: a session for a user who has a verified MFA
--      factor must be aal2 to pass is_gdo_user().
--   7. A small rate-limit primitive for public forms and sign-in.
--   8. The security.require_mfa setting (default OFF).
--
-- NOTE for future migrations: a column ADDED to person_employment is not
-- granted to `authenticated` automatically (column-level grants). Grant it
-- explicitly unless it is compensation.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Clean up an earlier draft of this migration (staging only) that used
--    helper functions; AGENTS.md forbids new RPCs executable by authenticated.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
begin
  foreach t in array array[
    'person_review', 'person_disciplinary_action', 'person_asset',
    'person_compliance_entry', 'person_onboarding_item', 'person_license'
  ] loop
    foreach p in array array['hr_record_read', 'hr_record_insert', 'hr_record_update', 'hr_record_delete'] loop
      execute format('drop policy if exists %I on greendogops.%I', p, t);
    end loop;
  end loop;
  foreach p in array array['person_document_read', 'person_document_insert', 'person_document_update', 'person_document_delete'] loop
    execute format('drop policy if exists %I on greendogops.person_document', p);
  end loop;
  execute 'drop policy if exists profile_transition_log_read on greendogops.profile_transition_log';
end $$;

drop function if exists greendogops.gdo_role();
drop function if exists greendogops.gdo_person_id();
drop function if exists greendogops.gdo_can_access_module(text);
drop function if exists greendogops.gdo_can_edit_module(text);
drop function if exists greendogops.gdo_hr_full();
drop function if exists greendogops.gdo_person_is_candidate(uuid);

-- ---------------------------------------------------------------------------
-- 6. is_gdo_user(): also require aal2 once the user has enrolled MFA
-- ---------------------------------------------------------------------------
create or replace function greendogops.is_gdo_user()
returns boolean
language sql
stable
security definer
set search_path = greendogops, pg_catalog
as $$
  select exists (
    select 1
    from greendogops.app_user
    where id = auth.uid()
      and is_active
  )
  and (
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status = 'verified'
    )
  );
$$;

-- Unchanged from 0164: policies evaluate it as the caller, so it stays executable.
revoke all on function greendogops.is_gdo_user() from public, anon;
grant execute on function greendogops.is_gdo_user() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2/3. Sensitive HR tables
-- ---------------------------------------------------------------------------
-- Predicates (the caller's own app_user row, read under app_user_read_self):
--   hr_full   role in owner/admin/executive/manager      (canViewSensitiveHr)
--   hr_edit   hr_full and HR module not overridden off   (canEditModule 'hr')
--   own       the row is the caller's own linked person
--   candidate the person is a prospect/applicant
--   ats_read  Recruiting module not overridden off       (canAccessModule 'ats')
--   ats_edit  ats_read and role is not staff             (canEditModule 'ats')
do $$
declare
  hr_full  constant text :=
    'exists (select 1 from greendogops.app_user u where u.id = auth.uid() and u.is_active '
    'and u.role::text in (''owner'', ''admin'', ''executive'', ''manager''))';
  hr_edit  constant text :=
    'exists (select 1 from greendogops.app_user u where u.id = auth.uid() and u.is_active '
    'and u.role::text in (''owner'', ''admin'', ''executive'', ''manager'') '
    'and case when jsonb_typeof(u.module_access -> ''hr'') = ''boolean'' '
    'then (u.module_access ->> ''hr'')::boolean else true end)';
  ats_read constant text :=
    'exists (select 1 from greendogops.app_user u where u.id = auth.uid() and u.is_active '
    'and case when jsonb_typeof(u.module_access -> ''ats'') = ''boolean'' '
    'then (u.module_access ->> ''ats'')::boolean else true end)';
  ats_edit constant text :=
    'exists (select 1 from greendogops.app_user u where u.id = auth.uid() and u.is_active '
    'and u.role::text <> ''staff'' '
    'and case when jsonb_typeof(u.module_access -> ''ats'') = ''boolean'' '
    'then (u.module_access ->> ''ats'')::boolean else true end)';
  t        text;
  own      text;
  cand     text;
  read_q   text;
  write_q  text;
begin
  -- HR-only tables: HR roles, or the employee's own record (read).
  foreach t in array array[
    'person_review',
    'person_disciplinary_action',
    'person_asset',
    'person_compliance_entry',
    'person_onboarding_item',
    'person_license'
  ] loop
    own := format(
      '%I.person_id = (select u.person_id from greendogops.app_user u where u.id = auth.uid() and u.is_active)', t);
    read_q  := format('greendogops.is_gdo_user() and (%s or %s)', hr_full, own);
    write_q := format('greendogops.is_gdo_user() and %s', hr_edit);

    execute format('drop policy if exists gdo_members_all on greendogops.%I', t);
    execute format('drop policy if exists hr_file_read on greendogops.%I', t);
    execute format('drop policy if exists hr_file_insert on greendogops.%I', t);
    execute format('drop policy if exists hr_file_update on greendogops.%I', t);
    execute format('drop policy if exists hr_file_delete on greendogops.%I', t);
    execute format('create policy hr_file_read on greendogops.%I for select to authenticated using (%s)', t, read_q);
    execute format('create policy hr_file_insert on greendogops.%I for insert to authenticated with check (%s)', t, write_q);
    execute format('create policy hr_file_update on greendogops.%I for update to authenticated using (%s) with check (%s)', t, write_q, write_q);
    execute format('create policy hr_file_delete on greendogops.%I for delete to authenticated using (%s)', t, write_q);
  end loop;

  -- Documents: HR file for employees, Recruiting for candidates.
  t := 'person_document';
  own  := format(
    '%I.person_id = (select u.person_id from greendogops.app_user u where u.id = auth.uid() and u.is_active)', t);
  cand := format(
    'exists (select 1 from greendogops.person p where p.id = %I.person_id and p.status::text in (''prospect'', ''applicant''))', t);
  read_q  := format('greendogops.is_gdo_user() and (%s or %s or (%s and %s))', hr_full, own, cand, ats_read);
  write_q := format('greendogops.is_gdo_user() and (%s or (%s and %s))', hr_edit, cand, ats_edit);
  execute 'drop policy if exists gdo_members_all on greendogops.person_document';
  execute 'drop policy if exists hr_file_read on greendogops.person_document';
  execute 'drop policy if exists hr_file_insert on greendogops.person_document';
  execute 'drop policy if exists hr_file_update on greendogops.person_document';
  execute 'drop policy if exists hr_file_delete on greendogops.person_document';
  execute format('create policy hr_file_read on greendogops.person_document for select to authenticated using (%s)', read_q);
  execute format('create policy hr_file_insert on greendogops.person_document for insert to authenticated with check (%s)', write_q);
  execute format('create policy hr_file_update on greendogops.person_document for update to authenticated using (%s) with check (%s)', write_q, write_q);
  execute format('create policy hr_file_delete on greendogops.person_document for delete to authenticated using (%s)', write_q);

  -- Stage history: read-only through the API (written by the service role in
  -- src/lib/shared/transition-log.ts). Rows without a person stay visible.
  t := 'profile_transition_log';
  own  := format(
    '%I.person_id = (select u.person_id from greendogops.app_user u where u.id = auth.uid() and u.is_active)', t);
  cand := format(
    'exists (select 1 from greendogops.person p where p.id = %I.person_id and p.status::text in (''prospect'', ''applicant''))', t);
  read_q := format(
    'greendogops.is_gdo_user() and (%I.person_id is null or %s or %s or (%s and %s))',
    t, hr_full, own, cand, ats_read);
  execute 'drop policy if exists gdo_members_all on greendogops.profile_transition_log';
  execute 'drop policy if exists hr_file_read on greendogops.profile_transition_log';
  execute 'drop policy if exists service_role_only on greendogops.profile_transition_log';
  execute format('create policy hr_file_read on greendogops.profile_transition_log for select to authenticated using (%s)', read_q);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Compensation columns: service role only
-- ---------------------------------------------------------------------------
-- A column-level REVOKE cannot carve out of a table-level GRANT, so drop the
-- table-level SELECT/INSERT/UPDATE and re-grant every non-compensation column.
-- The list matches COMPENSATION_FIELDS in src/lib/hr/types.ts.
revoke select, insert, update, references on greendogops.person_employment from authenticated;
revoke all on greendogops.person_employment from anon;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'greendogops'
    and table_name = 'person_employment'
    and column_name not in (
      'pay_type',
      'current_rate',
      'previous_rate',
      'latest_wage_change_date',
      'biweekly_wage',
      'annual_wages',
      'benefits_enrolled',
      'benefits_monthly',
      'benefits_annual',
      'ce_budget',
      'ce_used',
      'ce_remaining',
      'last_review_date'
    );
  execute format(
    'grant select (%1$s), insert (%1$s), update (%1$s) on greendogops.person_employment to authenticated',
    cols
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. Append-only audit log
-- ---------------------------------------------------------------------------
-- Every reader and writer in the app uses the service role.
drop policy if exists gdo_members_all on greendogops.audit_log;
drop policy if exists service_role_only on greendogops.audit_log;
create policy service_role_only on greendogops.audit_log
  for all to authenticated using (false) with check (false);
revoke all on greendogops.audit_log from anon, authenticated;
revoke update, delete, truncate on greendogops.audit_log from service_role;

create or replace function greendogops.audit_log_append_only()
returns trigger
language plpgsql
set search_path = greendogops, pg_catalog
as $$
begin
  raise exception 'greendogops.audit_log is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function greendogops.audit_log_append_only() from public, anon, authenticated;

drop trigger if exists audit_log_append_only_row on greendogops.audit_log;
create trigger audit_log_append_only_row
  before update or delete on greendogops.audit_log
  for each row execute function greendogops.audit_log_append_only();

drop trigger if exists audit_log_append_only_truncate on greendogops.audit_log;
create trigger audit_log_append_only_truncate
  before truncate on greendogops.audit_log
  for each statement execute function greendogops.audit_log_append_only();

comment on table greendogops.audit_log is
  'Append-only security/audit trail. UPDATE/DELETE/TRUNCATE are blocked by trigger for every role. A retention purge must be a deliberate, documented owner action (disable trigger, purge, re-enable) — see docs/security.md.';

-- ---------------------------------------------------------------------------
-- 7. Rate limiting primitive (fixed window), service role only
-- ---------------------------------------------------------------------------
create table if not exists greendogops.rate_limit_bucket (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

-- The event trigger from 0165 adds gdo_members_all to new tables; this table is
-- service-role only.
drop policy if exists gdo_members_all on greendogops.rate_limit_bucket;
alter table greendogops.rate_limit_bucket enable row level security;
drop policy if exists service_role_only on greendogops.rate_limit_bucket;
create policy service_role_only on greendogops.rate_limit_bucket
  for all to authenticated using (false) with check (false);
revoke all on greendogops.rate_limit_bucket from anon, authenticated;

create or replace function greendogops.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = greendogops, pg_catalog
as $$
declare
  v_hits integer;
begin
  insert into greendogops.rate_limit_bucket as b (bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update set
    hits = case
      when b.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else b.hits + 1
    end,
    window_start = case
      when b.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else b.window_start
    end
  returning hits into v_hits;

  -- Opportunistic cleanup keeps the table small without a cron.
  if random() < 0.01 then
    delete from greendogops.rate_limit_bucket
    where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function greendogops.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function greendogops.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8. MFA enforcement setting (OFF until an admin turns it on)
-- ---------------------------------------------------------------------------
insert into greendogops.app_setting (key, value, category, label, description)
values (
  'security.require_mfa',
  'false'::jsonb,
  'security',
  'Require two-step verification',
  'When enabled, Owners, Admins, Executives and HR/Managers must set up an authenticator app (TOTP) before they can use Green Dog Ops. Anyone who has already set one up is always asked for a code.'
)
on conflict (key) do nothing;

commit;
