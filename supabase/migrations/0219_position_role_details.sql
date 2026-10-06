-- 0219: richer open-position definitions for recruiters
--
-- The open-positions board only knew role, clinic, priority, status, openings
-- and free-text notes. Recruiters need the actual shape of the job: which days
-- must be covered, employment type, shift hours, pay range, start date and the
-- duties / qualifications to screen for.
--
-- employment_type and work_location_type reuse the HR vocabulary
-- (person_employment.work_schedule / work_location_type) so a filled position
-- maps straight onto the new hire's employment record.

alter table greendogops.position
  add column if not exists employment_type text,
  add column if not exists days_needed smallint[] not null default '{}',
  add column if not exists shift_start time,
  add column if not exists shift_end time,
  add column if not exists hours_per_week numeric(5,2),
  add column if not exists work_location_type text,
  add column if not exists pay_min numeric(10,2),
  add column if not exists pay_max numeric(10,2),
  add column if not exists pay_type text,
  add column if not exists target_start_date date,
  add column if not exists description text,
  add column if not exists requirements text;

alter table greendogops.position
  drop constraint if exists position_employment_type_check,
  add constraint position_employment_type_check
    check (employment_type is null or employment_type in ('full_time', 'part_time', 'per_diem', 'contractor')),
  drop constraint if exists position_work_location_type_check,
  add constraint position_work_location_type_check
    check (work_location_type is null or work_location_type in ('in_house', 'remote', 'hybrid')),
  drop constraint if exists position_pay_type_check,
  add constraint position_pay_type_check
    check (pay_type is null or pay_type in ('hourly', 'salary')),
  drop constraint if exists position_days_needed_check,
  add constraint position_days_needed_check
    check (days_needed <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  drop constraint if exists position_hours_per_week_check,
  add constraint position_hours_per_week_check
    check (hours_per_week is null or (hours_per_week > 0 and hours_per_week <= 80)),
  drop constraint if exists position_pay_range_check,
  add constraint position_pay_range_check
    check (
      (pay_min is null or pay_min >= 0)
      and (pay_max is null or pay_max >= 0)
      and (pay_min is null or pay_max is null or pay_min <= pay_max)
    );

comment on column greendogops.position.employment_type is 'full_time | part_time | per_diem | contractor';
comment on column greendogops.position.days_needed is 'Weekdays that must be covered, 0=Sun..6=Sat; empty = flexible';
comment on column greendogops.position.work_location_type is 'in_house | remote | hybrid';
comment on column greendogops.position.pay_type is 'hourly | salary — unit for pay_min / pay_max';
comment on column greendogops.position.description is 'Role summary and duties';
comment on column greendogops.position.requirements is 'Licenses, certifications, experience and skills to screen for';
