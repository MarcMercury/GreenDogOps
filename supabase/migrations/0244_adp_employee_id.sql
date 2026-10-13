-- ============================================================================
-- Green Dog Ops — 0244 ADP RUN Employee ID (go-live checklist item 18, plan D13)
-- ----------------------------------------------------------------------------
-- person_employment.adp_employee_id: the employee's ID / file number in ADP
-- RUN, the key the payroll hours file is matched on. Payroll data: like the
-- compensation columns (0227) it is NOT granted to the API role — read and
-- written only with the service role after the app's HR check
-- (canViewAllCompensation, or the employee's own record).
--
-- Unique when set (two people can never share a payroll ID); letters, digits
-- and dashes, up to 20 characters. Entered by HR on the profile's
-- Compensation tab or the roster grid; incomplete data is allowed and
-- highlighted (plan D12).
-- ============================================================================

set search_path = greendogops, public;

begin;

alter table greendogops.person_employment
  add column if not exists adp_employee_id text;

alter table greendogops.person_employment
  add constraint person_employment_adp_employee_id_format
    check (adp_employee_id is null or adp_employee_id ~ '^[A-Za-z0-9-]{1,20}$');

create unique index if not exists person_employment_adp_employee_id_uq
  on greendogops.person_employment (adp_employee_id)
  where adp_employee_id is not null;

comment on column greendogops.person_employment.adp_employee_id is
  'ADP RUN Employee ID / file number (0244): the key of the payroll hours export. Unique when set. Not granted to the API role — service role only, after the HR / own-record check.';

-- Belt and braces: a new column has no column grant, but make the intent explicit.
revoke select (adp_employee_id), insert (adp_employee_id), update (adp_employee_id)
  on greendogops.person_employment from anon, authenticated;

commit;
