-- ============================================================================
-- Green Dog Ops — 0247 Payroll Review + ADP RUN export settings
-- (owner process 2026-10-14: LOCK PERIOD → PAYROLL REVIEW → EXPORT ADP)
-- ----------------------------------------------------------------------------
-- pay_period.status   open → locked → reviewed → exported.
--                     locked   = approvals final, HR reviews and overrides.
--                     reviewed = review complete; review_snapshot frozen
--                                (the export reads only this copy).
--                     A reviewed period can go back to locked (more changes);
--                     Owner/Admin reopen to open as before.
-- payroll_override    HR's change to one employee's hours bucket in a locked
--                     period (or "exclude" from the file), with a reason.
--                     Append-only; the newest per (period, person, field)
--                     wins; hours NULL clears it. Only while status = locked.
-- app_setting         payroll.adp.* — the RUN Time Sheet Import settings
--                     (company code, earnings codes), edited in Admin ▸ Settings.
--
-- Service role only (payroll data). Keep 4 years (D10).
-- ============================================================================

set search_path = greendogops, public;

begin;

alter table greendogops.pay_period drop constraint if exists pay_period_status_check;
alter table greendogops.pay_period
  add constraint pay_period_status_check check (status in ('open', 'locked', 'reviewed', 'exported')),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid,
  add column review_snapshot jsonb check (review_snapshot is null or jsonb_typeof(review_snapshot) = 'array'),
  add constraint pay_period_review_stamp check (status <> 'reviewed' or review_snapshot is not null);

comment on column greendogops.pay_period.review_snapshot is
  'Payroll Review frozen at "Complete review" (0247): one entry per employee in the export with their final hours. The ADP export is built only from this.';

create table greendogops.payroll_override (
  id             uuid primary key default gen_random_uuid(),
  pay_period_id  uuid not null references greendogops.pay_period(id),
  person_id      uuid not null references greendogops.person(id),
  field          text not null check (field in ('regular', 'overtime', 'double_time', 'meal_premium', 'rest_premium', 'pto', 'exclude')),
  hours          numeric(7,2) check (hours is null or (hours >= 0 and hours <= 400)),
  reason         text not null check (length(btrim(reason)) between 1 and 1000),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint payroll_override_exclude_flag check (field <> 'exclude' or hours is null or hours in (0, 1))
);

comment on table greendogops.payroll_override is
  'Payroll Review overrides (0247): HR''s change to one employee''s hours bucket (or exclude from the export) in a locked period, with a reason. Append-only; newest per field wins; NULL hours clears. Service role only.';

create index payroll_override_period_idx on greendogops.payroll_override (pay_period_id, person_id, created_at);

create trigger payroll_override_append_only_row
  before update or delete on greendogops.payroll_override
  for each row execute function greendogops.time_record_append_only();
create trigger payroll_override_append_only_truncate
  before truncate on greendogops.payroll_override
  for each statement execute function greendogops.time_record_append_only();

create function greendogops.payroll_override_guard() returns trigger
  language plpgsql
  set search_path to 'greendogops', 'pg_catalog'
as $$
declare
  v_status text;
begin
  select status into v_status from greendogops.pay_period where id = new.pay_period_id;
  if v_status is distinct from 'locked' then
    raise exception 'payroll overrides can only be made while the period is locked for review (it is %)', coalesce(v_status, 'missing')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payroll_override_guard_row
  before insert on greendogops.payroll_override
  for each row execute function greendogops.payroll_override_guard();

alter table greendogops.payroll_override enable row level security;
drop policy if exists gdo_members_all on greendogops.payroll_override;
drop policy if exists service_role_only on greendogops.payroll_override;
create policy service_role_only on greendogops.payroll_override
  for all to authenticated using (false) with check (false);
revoke all on greendogops.payroll_override from anon, authenticated;
revoke all on function greendogops.payroll_override_guard() from public, anon, authenticated;

insert into greendogops.app_setting (key, value, category, label, description) values
  ('payroll.adp.company_code', '""'::jsonb, 'payroll', 'ADP RUN company code',
   'Your company code in RUN (shown when you log in to RUN, or ask your ADP rep). The "Co Code" column of the import file; required to export.'),
  ('payroll.adp.code.double_time', '""'::jsonb, 'payroll', 'RUN earnings code — double time',
   'Exactly as on RUN ▸ Reports ▸ Miscellaneous ▸ Earnings Codes. Regular and overtime go in their own columns and need no code.'),
  ('payroll.adp.code.meal_premium', '""'::jsonb, 'payroll', 'RUN earnings code — meal premium',
   'California meal-period premium (1 hour at the regular rate). Ask ADP to add this earning if RUN doesn''t have one.'),
  ('payroll.adp.code.rest_premium', '""'::jsonb, 'payroll', 'RUN earnings code — rest premium',
   'California rest-break premium (1 hour at the regular rate). Ask ADP to add this earning if RUN doesn''t have one.'),
  ('payroll.adp.code.pto', '""'::jsonb, 'payroll', 'RUN earnings code — PTO',
   'PTO hours (sick and vacation are one PTO bucket, 8 h a day).')
on conflict (key) do nothing;

commit;
