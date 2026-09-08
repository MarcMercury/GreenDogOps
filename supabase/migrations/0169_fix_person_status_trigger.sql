-- ============================================================================
-- 0169 — Fix the person status trigger (TG_OP case) and backfill is_active
--
-- greendogops.person_before_change() from 0021 guards its whole body with
--     if (tg_op = 'update' and ...)
-- but PL/pgSQL always sets TG_OP to UPPERCASE ('UPDATE'), and Postgres string
-- comparison is case sensitive — so 'UPDATE' = 'update' is FALSE and the body
-- has never executed. Consequence: is_active was never flipped when someone
-- became 'former' (5 former people were still flagged active) and
-- status_changed_at was never stamped by the trigger.
--
-- person_after_change() has the same 'insert' typo but survives it: its
-- status_changed test ORs in `new.status is distinct from old.status`, which is
-- true on a real status change AND on INSERT (old is null). That is why
-- sched_employee_setting.is_schedulable and the app_user deactivation did
-- cascade correctly. It is corrected here too, body otherwise verbatim.
-- ============================================================================

create or replace function greendogops.person_before_change()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
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

create or replace function greendogops.person_after_change()
returns trigger
language plpgsql
security definer
set search_path to 'greendogops'
as $$
declare
  schedulable    boolean := new.status in ('employee', 'contractor');
  status_changed boolean := (tg_op = 'INSERT') or (new.status is distinct from old.status);
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

-- Backfill what the broken BEFORE trigger never applied.
update greendogops.person
   set is_active = false, updated_at = now()
 where status = 'former' and is_active;

update greendogops.person
   set is_active = true, updated_at = now()
 where status in ('employee', 'contractor') and not is_active;
