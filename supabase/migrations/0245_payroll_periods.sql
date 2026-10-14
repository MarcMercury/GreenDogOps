-- ============================================================================
-- Green Dog Ops — 0245 Payroll: pay periods, timecard approval, lock, exports
-- (go-live checklist item 21, plan §G, D9, D10)
-- ----------------------------------------------------------------------------
-- pay_period          one row per biweekly period (Sun–Sat ×2, anchored
--                     2026-09-20; pay date = period end + 6 days, Fed-holiday
--                     Friday → Thursday — src/lib/timeclock/pay-period.ts).
--                     Created on demand. open → locked → exported.
-- timecard_approval   an approver (D9) approved one employee's period, with a
--                     snapshot of the totals they saw. Only while the period
--                     is open; un-approving deletes the row (audited in app).
-- payroll_export      every export of a locked period: who, when, format,
--                     employee count, totals and the file's SHA-256.
--                     Append-only.
-- Lock guard          once a period is locked, no timecard adjustment may be
--                     added for a work date inside it (a late correction
--                     needs an Owner/Admin to reopen the period). Punches are
--                     never refused, so time_punch itself is not guarded.
--
-- All service-role only (payroll data). Keep 4 years after the period (D10).
-- ============================================================================

set search_path = greendogops, public;

begin;

create table greendogops.pay_period (
  id            uuid primary key default gen_random_uuid(),
  period_start  date not null unique,
  period_end    date not null,
  pay_date      date not null,
  status        text not null default 'open' check (status in ('open', 'locked', 'exported')),
  locked_at     timestamptz,
  locked_by     uuid,
  reopened_at   timestamptz,
  reopened_by   uuid,
  reopen_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pay_period_14_days check (period_end = period_start + 13),
  constraint pay_period_sunday check (extract(dow from period_start) = 0),
  constraint pay_period_pay_after_end check (pay_date > period_end),
  constraint pay_period_lock_stamp check (status = 'open' or locked_at is not null)
);

comment on table greendogops.pay_period is
  'Biweekly pay periods (0245). open → locked (approvals final, no new adjustments) → exported. Service role only; keep 4 years.';

create trigger set_updated_at before update on greendogops.pay_period
  for each row execute function greendogops.set_updated_at();

create table greendogops.timecard_approval (
  id             uuid primary key default gen_random_uuid(),
  pay_period_id  uuid not null references greendogops.pay_period(id),
  person_id      uuid not null references greendogops.person(id),
  approved_by    uuid,
  approved_at    timestamptz not null default now(),
  snapshot       jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  unique (pay_period_id, person_id)
);

comment on table greendogops.timecard_approval is
  'An approver''s sign-off on one employee''s pay period with the totals snapshot (0245). Insert/delete only while the period is open; never updated. Service role only.';

create table greendogops.payroll_export (
  id              uuid primary key default gen_random_uuid(),
  pay_period_id   uuid not null references greendogops.pay_period(id),
  format          text not null,
  file_name       text not null,
  file_sha256     text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  employee_count  integer not null check (employee_count >= 0),
  totals          jsonb not null check (jsonb_typeof(totals) = 'object'),
  created_by      uuid,
  created_at      timestamptz not null default now()
);

comment on table greendogops.payroll_export is
  'Export history of locked pay periods (0245): format, file name, SHA-256, employee count, totals, who and when. Append-only. Service role only.';

create index payroll_export_period_idx on greendogops.payroll_export (pay_period_id, created_at desc);

-- Approval rows only change while their period is open.
create function greendogops.timecard_approval_guard() returns trigger
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'greendogops.timecard_approval rows are never edited; un-approve and approve again'
      using errcode = 'insufficient_privilege';
  end if;
  select status into v_status from greendogops.pay_period
   where id = case when tg_op = 'DELETE' then old.pay_period_id else new.pay_period_id end;
  if v_status is distinct from 'open' then
    raise exception 'pay period is % — approvals can only change while it is open', coalesce(v_status, 'missing')
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger timecard_approval_guard_row
  before insert or update or delete on greendogops.timecard_approval
  for each row execute function greendogops.timecard_approval_guard();

create trigger payroll_export_append_only_row
  before update or delete on greendogops.payroll_export
  for each row execute function greendogops.time_record_append_only();
create trigger payroll_export_append_only_truncate
  before truncate on greendogops.payroll_export
  for each statement execute function greendogops.time_record_append_only();

-- No timecard adjustment inside a locked period.
create function greendogops.time_adjustment_period_guard() returns trigger
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
begin
  if exists (
    select 1 from greendogops.pay_period pp
     where new.work_date between pp.period_start and pp.period_end
       and pp.status <> 'open'
  ) then
    raise exception 'the pay period containing % is locked — ask an Owner or Admin to reopen it', new.work_date
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger time_punch_adjustment_period_guard
  before insert on greendogops.time_punch_adjustment
  for each row execute function greendogops.time_adjustment_period_guard();

do $$
declare
  t text;
begin
  foreach t in array array['pay_period', 'timecard_approval', 'payroll_export']
  loop
    execute format('alter table greendogops.%I enable row level security', t);
    execute format('drop policy if exists gdo_members_all on greendogops.%I', t);
    execute format('drop policy if exists service_role_only on greendogops.%I', t);
    execute format(
      'create policy service_role_only on greendogops.%I for all to authenticated using (false) with check (false)',
      t
    );
    execute format('revoke all on greendogops.%I from anon, authenticated', t);
  end loop;
end
$$;

revoke all on function greendogops.timecard_approval_guard() from public, anon, authenticated;
revoke all on function greendogops.time_adjustment_period_guard() from public, anon, authenticated;

commit;
