-- Week Template: a populated, reusable schedule the admin can apply to any week.
-- Modeled as a normal sched_week flagged is_template=true (holds its own lines,
-- locations, closures, and staffed assignments). Excluded from the weeks list.

alter table greendogops.sched_week
  add column if not exists is_template boolean not null default false;

-- At most one week template exists at a time.
create unique index if not exists sched_week_single_template
  on greendogops.sched_week (is_template)
  where is_template;
