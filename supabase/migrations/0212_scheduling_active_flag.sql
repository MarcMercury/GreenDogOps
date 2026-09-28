-- ============================================================================
-- 0212 — "Scheduling Active" on the roster record
--
-- greendogops.sched_employee_setting.is_schedulable is the single flag that
-- decides whether a person appears in ANY scheduling surface (weekly grid shift
-- picker, Setup → Roles & Eligibility matrix, employee settings). It is now
-- edited directly from HR / Roster.
--
-- Policy:
--   * status = 'employee' AND person.is_active  → Scheduling Active
--   * every other status (prospect / applicant / contractor / former) and any
--     deactivated person                        → Scheduling Inactive
--   * a person can still be switched on/off by hand afterwards; the cascade
--     below only fires when status or is_active actually changes.
--
-- Previously contractors were force-flagged schedulable alongside employees and
-- the column defaulted to true, so any row created as a side effect (e.g. the
-- student Mentor/Coordinator flags) silently made that person schedulable.
-- ============================================================================

alter table greendogops.sched_employee_setting
  alter column is_schedulable set default false;

comment on column greendogops.sched_employee_setting.is_schedulable is
  'Scheduling Active. Only people flagged here appear in the schedule grid, the '
  'eligibility matrix, and shift pickers. Employees default to active; every '
  'other person status defaults to inactive. Edited from HR / Roster.';

-- ---------------------------------------------------------------------------
-- Cascade: person status / is_active → scheduling eligibility + login account.
-- Body is 0169's, with `schedulable` narrowed to active employees and the
-- change test widened to cover is_active flips.
-- ---------------------------------------------------------------------------
create or replace function greendogops.person_after_change()
returns trigger
language plpgsql
security definer
set search_path to 'greendogops'
as $$
declare
  schedulable    boolean := (new.status = 'employee' and new.is_active);
  status_changed boolean := (tg_op = 'INSERT')
                            or (new.status is distinct from old.status)
                            or (new.is_active is distinct from old.is_active);
  synced_name    text;
begin
  -- (a) Status transitions cascade into scheduling eligibility + access.
  if status_changed then
    if schedulable then
      -- An active employee is schedulable and must have a settings row so they
      -- appear in the schedule Setup + grids.
      insert into greendogops.sched_employee_setting (person_id, is_schedulable)
      values (new.id, true)
      on conflict (person_id) do update set is_schedulable = true;
    else
      -- Prospects / applicants / contractors / former staff are not schedulable
      -- until someone switches them on explicitly.
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

-- ---------------------------------------------------------------------------
-- Backfill to the new policy.
-- ---------------------------------------------------------------------------
insert into greendogops.sched_employee_setting (person_id, is_schedulable)
select p.id, true
from greendogops.person p
where p.status = 'employee' and p.is_active
on conflict (person_id) do update set is_schedulable = true;

update greendogops.sched_employee_setting s
   set is_schedulable = false, updated_at = now()
  from greendogops.person p
 where s.person_id = p.id
   and not (p.status = 'employee' and p.is_active)
   and s.is_schedulable;
