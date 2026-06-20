-- ============================================================================
-- Green Dog Ops — 0021 Entity connectivity & status propagation
-- ----------------------------------------------------------------------------
-- One person, many faces. The same `person` row powers the HR roster, the ATS,
-- and the schedule grid — and (once invited) a login account in `app_user`.
-- This migration wires those together so data stays consistent and a status
-- change in one place automatically updates the others:
--
--   1. app_user.person_id    — links a login account to its roster person.
--   2. person BEFORE trigger  — stamps status_changed_at + aligns is_active.
--   3. person AFTER trigger   — cascades status into scheduling eligibility and
--                               a linked login account, and keeps identity
--                               (name / email) in sync across all three.
--   4. Backfill               — link existing users by email, and ensure every
--                               schedulable person has a scheduling settings row.
-- All objects live in the isolated `greendogops` schema.
-- ============================================================================
set search_path = greendogops, public;

-- ---------------------------------------------------------------------------
-- 1. Link the login account (app_user) to the shared person record.
--    app_user.id stays = auth.users.id; person_id is the new bridge to HR.
-- ---------------------------------------------------------------------------
alter table greendogops.app_user
  add column if not exists person_id uuid
    references greendogops.person (id) on delete set null;

-- A person can have at most one login account.
create unique index if not exists app_user_person_idx
  on greendogops.app_user (person_id)
  where person_id is not null;

-- ---------------------------------------------------------------------------
-- 2. BEFORE trigger: keep the person row internally consistent.
--    On a status change, stamp the timestamp and align the active flag so
--    "former" staff drop out of active lists everywhere automatically.
-- ---------------------------------------------------------------------------
create or replace function greendogops.person_before_change()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'update' and new.status is distinct from old.status) then
    new.status_changed_at := now();
    if new.status in ('employee', 'contractor') then
      new.is_active := true;
    elsif new.status = 'former' then
      new.is_active := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists person_before_change on greendogops.person;
create trigger person_before_change
  before insert or update on greendogops.person
  for each row execute function greendogops.person_before_change();

-- ---------------------------------------------------------------------------
-- 3. AFTER trigger: cascade the change into the other modules.
--    security definer so the cascade can reach sched_employee_setting and
--    app_user regardless of the caller's RLS scope.
-- ---------------------------------------------------------------------------
create or replace function greendogops.person_after_change()
returns trigger
language plpgsql
security definer
set search_path = greendogops
as $$
declare
  schedulable    boolean := new.status in ('employee', 'contractor');
  status_changed boolean := (tg_op = 'insert') or (new.status is distinct from old.status);
  synced_name    text;
begin
  -- (a) Status transitions cascade into scheduling eligibility + access.
  if status_changed then
    if schedulable then
      -- A working employee/contractor should be schedulable and must have a
      -- settings row so they appear in the schedule Setup + grids.
      insert into greendogops.sched_employee_setting (person_id, is_schedulable)
      values (new.id, true)
      on conflict (person_id) do update set is_schedulable = true;
    else
      -- Prospects / applicants / former staff are not schedulable.
      update greendogops.sched_employee_setting
        set is_schedulable = false
        where person_id = new.id;

      -- A departing employee automatically loses their login account.
      if new.status = 'former' then
        update greendogops.app_user
          set is_active = false
          where person_id = new.id;
      end if;
    end if;
  end if;

  -- (b) Identity always stays in sync with a linked login account, so the
  --     roster and the user list can never drift apart.
  synced_name := nullif(
    trim(coalesce(new.full_name, concat_ws(' ', new.first_name, new.last_name))),
    ''
  );
  update greendogops.app_user
    set full_name = coalesce(synced_name, full_name),
        email     = coalesce(new.email, email)
    where person_id = new.id;

  return null;
end;
$$;

drop trigger if exists person_after_change on greendogops.person;
create trigger person_after_change
  after insert or update on greendogops.person
  for each row execute function greendogops.person_after_change();

-- ---------------------------------------------------------------------------
-- 4a. Backfill: link existing login accounts to their roster person by email
--     (case-insensitive). Skip ambiguous emails shared by multiple persons.
-- ---------------------------------------------------------------------------
update greendogops.app_user u
set person_id = p.id
from greendogops.person p
where u.person_id is null
  and p.email is not null
  and lower(p.email) = lower(u.email)
  and (
    select count(*) from greendogops.person p2
    where p2.email is not null and lower(p2.email) = lower(u.email)
  ) = 1;

-- ---------------------------------------------------------------------------
-- 4b. Backfill: every current employee/contractor gets a scheduling settings
--     row (idempotent), and any non-working person is marked not schedulable.
-- ---------------------------------------------------------------------------
insert into greendogops.sched_employee_setting (person_id, is_schedulable)
select p.id, true
from greendogops.person p
where p.status in ('employee', 'contractor')
on conflict (person_id) do nothing;

update greendogops.sched_employee_setting s
set is_schedulable = false
from greendogops.person p
where s.person_id = p.id
  and p.status not in ('employee', 'contractor')
  and s.is_schedulable;
