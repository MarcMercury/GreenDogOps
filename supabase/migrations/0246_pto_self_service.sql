-- ============================================================================
-- Green Dog Ops — 0246 PTO self-service: Ops owns the PTO balance
-- (go-live checklist items 23 + 24, plan D8, D8c)
-- ----------------------------------------------------------------------------
-- Owner decision 2026-10-14: the balance on the HR profile
-- (person_employment.pto_used / pto_available, in days) IS the opening
-- balance — no separate load. From now on Ops keeps it current: approving a
-- request deducts its days immediately; denying, reopening or deleting an
-- approved request gives them back. The nightly HR-roster sheet sync stops
-- writing the PTO columns (app change in the same release).
--
-- person_time_off
--   pto_days           days the request uses (whole days; a partial sick day
--                      is a fraction, 2 h = 0.25). NULL = every calendar day
--                      in the range.
--   pto_days_deducted  what this request currently holds against the
--                      balance. Maintained only by the trigger below.
--   balance_tracked    false for requests already approved before this
--                      migration — the sheet's "PTO used" already counts them,
--                      so they never move the balance.
--   review_note        the approver's optional note.
--   Only kinds pto / vacation deduct; time_off = unpaid.
--
-- pto_ledger           append-only history of every change to a person's PTO
--                      allotment / used / available, automatic (time_off,
--                      with the request id) or manual (HR edit). Service role.
-- ============================================================================

set search_path = greendogops, public;

begin;

alter table greendogops.person_time_off
  add column pto_days numeric(5,2) check (pto_days is null or (pto_days >= 0 and pto_days <= 400)),
  add column pto_days_deducted numeric(5,2) not null default 0,
  add column balance_tracked boolean not null default true,
  add column review_note text check (review_note is null or length(review_note) <= 1000);

comment on column greendogops.person_time_off.pto_days is
  'PTO days this request uses (0246). Whole days; a partial sick day is a fraction (2 h = 0.25). NULL = every calendar day in the range. 0 = approve without deducting.';
comment on column greendogops.person_time_off.pto_days_deducted is
  'Days this request currently holds against person_employment.pto_available (0246). Set only by the person_time_off_balance trigger.';
comment on column greendogops.person_time_off.balance_tracked is
  'false = approved before Ops owned the balance (0246); the sheet already counted it, so it never moves the balance.';
comment on column greendogops.person_time_off.review_note is
  'Optional note from the approver (0246).';
comment on column greendogops.person_time_off.source is
  'Origin of the request: manual (HR profile), self (My Time), wheniwork (email import), vacation_pdf_2026 (one-off import).';

-- Already-approved requests were counted by the sheet.
update greendogops.person_time_off set balance_tracked = false where status = 'approved';

create table greendogops.pto_ledger (
  id                 uuid primary key default gen_random_uuid(),
  person_id          uuid not null references greendogops.person(id),
  source             text not null check (source in ('time_off', 'manual')),
  time_off_id        uuid,
  reason             text,
  allotment_before   text,
  allotment_after    text,
  extra_before       numeric(6,2),
  extra_after        numeric(6,2),
  used_before        numeric(6,2),
  used_after         numeric(6,2),
  available_before   numeric(6,2),
  available_after    numeric(6,2),
  actor_auth_id      uuid,
  created_at         timestamptz not null default now()
);

comment on table greendogops.pto_ledger is
  'Append-only history of every PTO allotment / used / available change (0246): automatic from time-off approvals (time_off_id) or manual HR edits. Service role only; HR-private.';

create index pto_ledger_person_idx on greendogops.pto_ledger (person_id, created_at desc);

create trigger pto_ledger_append_only_row
  before update or delete on greendogops.pto_ledger
  for each row execute function greendogops.time_record_append_only();
create trigger pto_ledger_append_only_truncate
  before truncate on greendogops.pto_ledger
  for each statement execute function greendogops.time_record_append_only();

-- Keeps the balance in step with each request. Everything is inline (no helper
-- functions) so no EXECUTE grant is needed by the roles whose edits fire it.
-- The deduction rule is mirrored in src/lib/pto/balance.ts (deductionDays).
create function greendogops.person_time_off_balance() returns trigger
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_new numeric := 0;
  v_old numeric := 0;
  v_people uuid[];
  v_deltas numeric[];
  v_reasons text[];
  v_ids uuid[];
  i int;
begin
  if tg_op <> 'INSERT' then
    v_old := coalesce(old.pto_days_deducted, 0);
  end if;
  if tg_op <> 'DELETE' then
    v_new := case
      when new.status::text = 'approved' and new.balance_tracked and new.kind::text in ('pto', 'vacation')
        then coalesce(new.pto_days, (new.end_date - new.start_date + 1)::numeric)
      else 0::numeric
    end;
  end if;

  if tg_op = 'DELETE' then
    v_people := array[old.person_id]; v_deltas := array[-v_old];
    v_reasons := array['request deleted']; v_ids := array[old.id];
  elsif tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
    v_people := array[old.person_id, new.person_id]; v_deltas := array[-v_old, v_new];
    v_reasons := array['request moved to another person', 'request moved from another person'];
    v_ids := array[old.id, new.id];
  else
    v_people := array[new.person_id]; v_deltas := array[v_new - v_old];
    v_reasons := array[case
      when v_old = 0 then 'request approved'
      when v_new = 0 then 'request ' || new.status::text
      else 'approved request changed'
    end];
    v_ids := array[new.id];
  end if;

  for i in 1 .. array_length(v_people, 1) loop
    continue when v_deltas[i] = 0;
    perform set_config('greendogops.pto_source', 'time_off', true);
    perform set_config('greendogops.pto_time_off', v_ids[i]::text, true);
    perform set_config('greendogops.pto_reason', v_reasons[i], true);
    update greendogops.person_employment
       set pto_used = coalesce(pto_used, 0) + v_deltas[i],
           pto_available = pto_available - v_deltas[i]
     where person_id = v_people[i];
    if not found then
      insert into greendogops.person_employment (person_id, pto_used) values (v_people[i], v_deltas[i]);
    end if;
    perform set_config('greendogops.pto_source', '', true);
    perform set_config('greendogops.pto_time_off', '', true);
    perform set_config('greendogops.pto_reason', '', true);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.pto_days_deducted := v_new;
  return new;
end;
$$;

create trigger person_time_off_balance_row
  before insert or update on greendogops.person_time_off
  for each row execute function greendogops.person_time_off_balance();
create trigger person_time_off_balance_delete
  after delete on greendogops.person_time_off
  for each row execute function greendogops.person_time_off_balance();

-- Ledger: every PTO change on the employment row. SECURITY DEFINER only so an
-- HR user's edit can append to the service-role-only ledger.
create function greendogops.person_employment_pto_ledger() returns trigger
  language plpgsql
  security definer
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_source text := nullif(current_setting('greendogops.pto_source', true), '');
  v_time_off text := nullif(current_setting('greendogops.pto_time_off', true), '');
begin
  insert into greendogops.pto_ledger (
    person_id, source, time_off_id, reason,
    allotment_before, allotment_after, extra_before, extra_after,
    used_before, used_after, available_before, available_after, actor_auth_id
  ) values (
    new.person_id,
    coalesce(v_source, 'manual'),
    v_time_off::uuid,
    nullif(current_setting('greendogops.pto_reason', true), ''),
    case when tg_op = 'UPDATE' then old.pto_allotment end, new.pto_allotment,
    case when tg_op = 'UPDATE' then old.pto_policy_allotment end, new.pto_policy_allotment,
    case when tg_op = 'UPDATE' then old.pto_used end, new.pto_used,
    case when tg_op = 'UPDATE' then old.pto_available end, new.pto_available,
    auth.uid()
  );
  return null;
end;
$$;

create trigger person_employment_pto_ledger_update
  after update on greendogops.person_employment
  for each row
  when (
    old.pto_allotment is distinct from new.pto_allotment
    or old.pto_policy_allotment is distinct from new.pto_policy_allotment
    or old.pto_used is distinct from new.pto_used
    or old.pto_available is distinct from new.pto_available
  )
  execute function greendogops.person_employment_pto_ledger();
create trigger person_employment_pto_ledger_insert
  after insert on greendogops.person_employment
  for each row
  when (
    new.pto_allotment is not null or new.pto_policy_allotment is not null
    or new.pto_used is not null or new.pto_available is not null
  )
  execute function greendogops.person_employment_pto_ledger();

alter table greendogops.pto_ledger enable row level security;
drop policy if exists gdo_members_all on greendogops.pto_ledger;
drop policy if exists service_role_only on greendogops.pto_ledger;
create policy service_role_only on greendogops.pto_ledger
  for all to authenticated using (false) with check (false);
revoke all on greendogops.pto_ledger from anon, authenticated;

revoke all on function greendogops.person_time_off_balance() from public, anon, authenticated;
revoke all on function greendogops.person_employment_pto_ledger() from public, anon, authenticated;

commit;
