-- Flag assignments edited after a week enters "Pending Approval" so the
-- schedule maker gets a light-blue visual cue for the changes the approver
-- wants made before publishing. Reset to false on every workflow transition
-- (see setWeekStatus) so each approval round starts from a clean baseline.
alter table greendogops.sched_assignment
  add column if not exists changed_after_approval boolean not null default false;
